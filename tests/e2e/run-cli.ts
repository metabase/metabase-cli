import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { execa } from "execa";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_ENTRY = resolve(REPO_ROOT, "dist", "cli.mjs");

export interface RunCliOptions {
  args: ReadonlyArray<string>;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  configHome?: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  configHome: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  const configHome = opts.configHome ?? (await mkTempConfigHome());
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    XDG_CONFIG_HOME: configHome,
    MB_CLI_DISABLE_KEYRING: "1",
    ...opts.env,
  };

  const result = await execa("node", [CLI_ENTRY, ...opts.args], {
    env,
    reject: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    encoding: "utf8",
    stdout: "pipe",
    stderr: "pipe",
    input: opts.stdin ?? "",
  });

  if (typeof result.exitCode !== "number") {
    const cause = result.signal ? `signal ${result.signal}` : "no exit code";
    throw new Error(
      `mb CLI process did not exit normally (${cause}); stderr:\n${asString(result.stderr)}`,
    );
  }

  return {
    stdout: asString(result.stdout),
    stderr: asString(result.stderr),
    exitCode: result.exitCode,
    configHome,
  };
}

// execa's stdout/stderr are typed as a union covering all encoding modes,
// so we narrow at runtime even though `encoding: "utf8"` guarantees a string.
function asString(stream: unknown): string {
  if (typeof stream !== "string") {
    throw new Error(`expected execa to return a string with encoding utf8, got ${typeof stream}`);
  }
  return stream;
}

export async function mkTempConfigHome(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "metabase-cli-e2e-"));
}

export async function cleanupConfigHome(path: string): Promise<void> {
  await fs.rm(path, { recursive: true, force: true });
}
