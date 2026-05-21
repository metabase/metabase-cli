// Each stack runs in an isolated docker-compose project (own port, app-db volume,
// bootstrap file, and snapshot) so lanes can run concurrently without colliding.
import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { errorMessage } from "../src/core/errors";

interface Stack {
  id: string;
  image: string;
  port: number;
}

const STACKS: readonly Stack[] = [
  { id: "oss-58", image: "metabase/metabase:v0.58.15", port: 13058 },
  { id: "ee-58", image: "metabase/metabase-enterprise:v1.58.15", port: 13158 },
  { id: "oss-59", image: "metabase/metabase:v0.59.12", port: 13059 },
  { id: "ee-59", image: "metabase/metabase-enterprise:v1.59.12", port: 13159 },
  { id: "oss-60", image: "metabase/metabase:v0.60.7", port: 13060 },
  { id: "ee-60", image: "metabase/metabase-enterprise:v1.60.7", port: 13160 },
  { id: "oss-61", image: "metabase/metabase:v0.61.2", port: 13061 },
  { id: "ee-61", image: "metabase/metabase-enterprise:v1.61.2", port: 13161 },
  { id: "oss-head", image: "metabase/metabase-head:latest", port: 13062 },
  {
    id: "ee-head",
    image: "metabase/metabase-enterprise-head:latest",
    port: 13162,
  },
];

const DEFAULT_PARALLELISM = 2;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const COMPOSE_FILE = resolve(REPO_ROOT, "tests/e2e/docker-compose.yml");
const DIST_CLI = resolve(REPO_ROOT, "dist", "cli.mjs");

interface CliOptions {
  stacks: Stack[];
  parallelism: number;
}

interface StackResult {
  id: string;
  ok: boolean;
  logPath: string | null;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let selected: Stack[] = [...STACKS];
  let parallelism = 1;
  for (const arg of argv) {
    if (arg.startsWith("--stack=")) {
      selected = [resolveStack(arg.slice("--stack=".length))];
    } else if (arg === "--parallel") {
      parallelism = DEFAULT_PARALLELISM;
    } else if (arg.startsWith("--parallel=")) {
      parallelism = parsePositiveInt(arg.slice("--parallel=".length));
    } else {
      throw new Error(
        `Unknown argument: ${arg}. Usage: e2e-matrix [--stack=<id>] [--parallel[=N]]`,
      );
    }
  }
  return { stacks: selected, parallelism };
}

function resolveStack(id: string): Stack {
  const stack = STACKS.find((candidate) => candidate.id === id);
  if (stack === undefined) {
    const ids = STACKS.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown stack "${id}". Known stacks: ${ids}.`);
  }
  return stack;
}

function parsePositiveInt(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--parallel expects a positive integer, got "${raw}".`);
  }
  return value;
}

function stackEnv(stack: Stack): NodeJS.ProcessEnv {
  return {
    ...process.env,
    METABASE_CLI_E2E_STACK: stack.id,
    METABASE_E2E_IMAGE: stack.image,
    METABASE_E2E_PORT: String(stack.port),
    METABASE_CLI_E2E_URL: `http://localhost:${stack.port}`,
    // Namespaces the compose project for both the runner's own `docker compose`
    // calls and the ones the spawned test process makes (e.g. warehouse reset),
    // so concurrent stacks never target each other's containers.
    COMPOSE_PROJECT_NAME: `mb-e2e-${stack.id}`,
    // Consulted by requireServer only when the probe can't parse a version (head builds),
    // so capability-gated suites run against head instead of skipping.
    ...(stack.id.endsWith("-head") ? { METABASE_CLI_E2E_ASSUME_HEAD: "1" } : {}),
  };
}

function composeArgs(rest: readonly string[]): string[] {
  return ["compose", "-f", COMPOSE_FILE, ...rest];
}

// Capture Metabase container logs before `down -v` removes the container, so CI can
// upload them as a per-stack artifact when a lane fails.
async function captureMetabaseLog(stack: Stack, env: NodeJS.ProcessEnv): Promise<void> {
  const logFile = resolve(REPO_ROOT, `metabase-${stack.id}.log`);
  const result = await execa("docker", composeArgs(["logs", "--no-color", "metabase"]), {
    env,
    reject: false,
    all: true,
  });
  await fs.writeFile(logFile, result.all ?? "");
}

async function runStackLive(stack: Stack): Promise<StackResult> {
  const env = stackEnv(stack);
  const docker = (rest: string[]) =>
    execa("docker", composeArgs(rest), { env, stdio: "inherit", reject: false });
  try {
    const up = await docker(["up", "-d", "--wait"]);
    if (up.exitCode !== 0) {
      return { id: stack.id, ok: false, logPath: null };
    }
    const test = await execa("bun", ["run", "test:e2e"], {
      cwd: REPO_ROOT,
      env,
      stdio: "inherit",
      reject: false,
    });
    return { id: stack.id, ok: test.exitCode === 0, logPath: null };
  } finally {
    await captureMetabaseLog(stack, env);
    await docker(["down", "-v"]);
  }
}

async function runStackToLog(stack: Stack): Promise<StackResult> {
  const env = stackEnv(stack);
  const logPath = join(tmpdir(), `e2e-matrix-${stack.id}.log`);
  await fs.writeFile(logPath, `# e2e-matrix ${stack.id} (${stack.image})\n`);
  const step = async (label: string, file: string, args: string[]): Promise<boolean> => {
    const result = await execa(file, args, { cwd: REPO_ROOT, env, reject: false, all: true });
    await fs.appendFile(logPath, `\n$ ${label}\n${result.all ?? ""}\n`);
    return result.exitCode === 0;
  };
  process.stdout.write(`[${stack.id}] starting (${stack.image})\n`);
  try {
    const up = await step("docker up", "docker", composeArgs(["up", "-d", "--wait"]));
    if (!up) {
      return { id: stack.id, ok: false, logPath };
    }
    const ok = await step("test:e2e", "bun", ["run", "test:e2e"]);
    return { id: stack.id, ok, logPath };
  } finally {
    await captureMetabaseLog(stack, env);
    await step("docker down", "docker", composeArgs(["down", "-v"]));
    process.stdout.write(`[${stack.id}] done\n`);
  }
}

async function runChunked(stacks: readonly Stack[], parallelism: number): Promise<StackResult[]> {
  const results: StackResult[] = [];
  for (let start = 0; start < stacks.length; start += parallelism) {
    const chunk = stacks.slice(start, start + parallelism);
    const chunkResults = await Promise.all(chunk.map(runStackToLog));
    results.push(...chunkResults);
  }
  return results;
}

function printSummary(results: readonly StackResult[]): void {
  process.stdout.write("\n=== e2e matrix summary ===\n");
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    const log = result.logPath === null ? "" : `  (log: ${result.logPath})`;
    process.stdout.write(`  ${status}  ${result.id}${log}\n`);
  }
}

async function main(): Promise<void> {
  if (!existsSync(DIST_CLI)) {
    throw new Error(`Built CLI missing at ${DIST_CLI} — run \`bun run build\` first.`);
  }
  const { stacks, parallelism } = parseArgs(process.argv.slice(2));

  const results =
    parallelism > 1 ? await runChunked(stacks, parallelism) : await sequential(stacks);

  printSummary(results);
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

async function sequential(stacks: readonly Stack[]): Promise<StackResult[]> {
  const results: StackResult[] = [];
  for (const stack of stacks) {
    results.push(await runStackLive(stack));
  }
  return results;
}

main().catch((error: unknown) => {
  process.stderr.write(`e2e-matrix failed: ${errorMessage(error)}\n`);
  process.exit(1);
});
