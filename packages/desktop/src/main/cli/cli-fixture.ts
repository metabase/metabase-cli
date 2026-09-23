import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import type { SessionEnvironment } from "../../contracts/connection";
import { runCommand } from "../process/spawn";

import { RUN_AS_NODE_ENV_VAR, SKILLS_DIR_ENV_VAR, cliLocation, type CliLocation } from "./paths";
import { MetabaseCli } from "./runner";
import { WORKTREE_ENV_VAR } from "../metabase/worktrees";

const RESPONSES_FILE = "responses.mjs";
const CALLS_FILE = "calls.jsonl";
const FIXTURE_DIR_ENV_VAR = "RDE_CLI_FIXTURE_DIR";
const COMMAND_WORDS = 2;
const RECORDED_ENV = [
  "MB_URL",
  "MB_AUTH_BROKER",
  "MB_AUTH_BROKER_TOKEN",
  SKILLS_DIR_ENV_VAR,
  RUN_AS_NODE_ENV_VAR,
  WORKTREE_ENV_VAR,
];

// Stands in for the CLI's entry: answers each command, keyed by its first two words, with a recorded
// stdout, stderr and exit code, and writes down what it was run with.
const FIXTURE_SCRIPT = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = process.env.${FIXTURE_DIR_ENV_VAR};
const args = process.argv.slice(2);
const key = args.slice(0, ${COMMAND_WORDS}).join(" ");
const { default: answers } = await import(pathToFileURL(join(dir, "${RESPONSES_FILE}")).href);
const answer = answers[key];
const env = {};
for (const name of ${JSON.stringify(RECORDED_ENV)}) {
  env[name] = process.env[name] ?? null;
}
appendFileSync(join(dir, "${CALLS_FILE}"), JSON.stringify({ args, cwd: process.cwd(), env }) + "\\n");
if (answer === undefined) {
  process.stderr.write("no fixture answer for " + key);
  process.exit(9);
}
process.stdout.write(answer.stdout);
process.stderr.write(answer.stderr);
process.exitCode = answer.exit;
`;

export interface FixtureAnswer {
  readonly stdout: string;
  readonly stderr: string;
  readonly exit: number;
}

const FixtureCall = z.object({
  args: z.array(z.string()),
  cwd: z.string(),
  env: z.record(z.string(), z.string().nullable()),
});
export type FixtureCall = z.infer<typeof FixtureCall>;

export const FIXTURE_CREDENTIALS: SessionEnvironment = {
  sessionId: "brk_fixture",
  MB_URL: "http://metabase.test",
  MB_AUTH_BROKER: "http://127.0.0.1:1",
  MB_AUTH_BROKER_TOKEN: "token-fixture",
};

export interface CliFixture {
  readonly cli: MetabaseCli;
  readonly location: CliLocation;
  readonly released: string[];
  answer(command: string, answer: FixtureAnswer): Promise<void>;
  calls(): Promise<FixtureCall[]>;
  close(): Promise<void>;
}

function writeResponses(dir: string, answers: Record<string, FixtureAnswer>): Promise<void> {
  return writeFile(
    join(dir, RESPONSES_FILE),
    `export default ${JSON.stringify(answers)};\n`,
    "utf8",
  );
}

async function readCalls(path: string): Promise<FixtureCall[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => parseJson(line, FixtureCall));
}

export async function recorded(name: string): Promise<string> {
  return readFile(join(import.meta.dirname, "fixtures", name), "utf8");
}

export async function openCliFixture(credentials: SessionEnvironment | null): Promise<CliFixture> {
  const dir = await mkdtemp(join(tmpdir(), "rde-cli-fixture-"));
  const outDir = join(dir, "packages", "desktop", "out");
  const location = cliLocation({ kind: "dev", outDir }, process.execPath);
  const entryDir = join(dir, "packages", "cli", "dist");
  await mkdir(entryDir, { recursive: true });
  await writeFile(location.entry, FIXTURE_SCRIPT, "utf8");
  const answers: Record<string, FixtureAnswer> = {};
  await writeResponses(dir, answers);
  const released: string[] = [];
  const cli = new MetabaseCli({
    location,
    run: runCommand,
    env: { PATH: process.env["PATH"], [FIXTURE_DIR_ENV_VAR]: dir },
    credentials: () => credentials,
    release: (brokerSessionId) => {
      released.push(brokerSessionId);
    },
    signal: new AbortController().signal,
  });
  return {
    cli,
    location,
    released,
    answer: async (command, answer) => {
      answers[command] = answer;
      await writeResponses(dir, answers);
    },
    calls: () => readCalls(join(dir, CALLS_FILE)),
    close: () => rm(dir, { recursive: true, force: true }),
  };
}
