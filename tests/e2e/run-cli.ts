import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { execa } from "execa";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_ENTRY = resolve(REPO_ROOT, "packages", "cli", "dist", "cli.mjs");

// One probe cache per test file, so the CLI under test reads only probes it took during that file
// and the developer's own cache stays untouched. `cleanupCacheHome` drops it after the file.
export const CACHE_HOME = mkdtempSync(join(tmpdir(), "metabase-cli-e2e-cache-"));

export interface RunCliOptions {
  args: ReadonlyArray<string>;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// The spawned CLI runs on an allowlist, so no `MB_*` from the developer's shell can point a test at
// their own instance. `PATH` resolves the `node` binary; `HOME` and `TMPDIR` back the platform's
// temp directories.
const INHERITED_ENV_KEYS = ["PATH", "HOME", "TMPDIR"] as const;

function inheritedEnv(): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      inherited[key] = value;
    }
  }
  return inherited;
}

function childEnv(opts: RunCliOptions): NodeJS.ProcessEnv {
  return { ...inheritedEnv(), XDG_CACHE_HOME: CACHE_HOME, ...opts.env };
}

export async function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  const env = childEnv(opts);

  const result = await execa("node", [CLI_ENTRY, ...opts.args], {
    env,
    extendEnv: false,
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
  };
}

export interface RunCliInterruptOptions extends RunCliOptions {
  interruptAfterMs: number;
}

// Ctrl-C reaches the CLI as SIGINT delivered to its pid, which is what a terminal's line
// discipline does with 0x03 and what `execa`'s `kill` reproduces without a pty. A process killed
// *by* the signal reports no exit code at all, so an exact code here is also proof the CLI handled
// it rather than dying of Node's default disposition.
export async function runCliInterrupt(opts: RunCliInterruptOptions): Promise<RunCliResult> {
  const env = childEnv(opts);

  const subprocess = execa("node", [CLI_ENTRY, ...opts.args], {
    env,
    extendEnv: false,
    reject: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    encoding: "utf8",
    stdout: "pipe",
    stderr: "pipe",
    input: opts.stdin ?? "",
  });

  const interrupt = setTimeout(() => subprocess.kill("SIGINT"), opts.interruptAfterMs);
  const result = await subprocess.finally(() => {
    clearTimeout(interrupt);
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

export async function cleanupCacheHome(): Promise<void> {
  await fs.rm(CACHE_HOME, { recursive: true, force: true });
}
