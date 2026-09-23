import { delimiter } from "node:path";

import type { RunCommand } from "./spawn";

const LOGIN_SHELL_OUTPUT_LIMIT_BYTES = 64 * 1024;

const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const SHELL_ENV_VAR = "SHELL";
const PATH_ENV_VAR = "PATH";
const LOGIN_SHELL_ARGS = ["-ilc", "echo $PATH"] as const;

interface LoginShellRead {
  readonly kind: "read";
  readonly shell: string;
}

interface LoginShellUnavailable {
  readonly kind: "unavailable";
  readonly reason: string;
}

type LoginShellOutcome = LoginShellRead | LoginShellUnavailable;

export interface MergedPath {
  readonly entries: readonly string[];
  readonly value: string;
  readonly loginShell: LoginShellOutcome;
}

interface PathRequest {
  readonly env: NodeJS.ProcessEnv;
  readonly run: RunCommand;
  readonly signal: AbortSignal;
}

function splitPath(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

// Login rc files print their own banners, so the last line that looks like a `PATH` is the answer.
function lastPathLine(stdout: string): string | null {
  const lines = stdout.split("\n").map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line !== undefined && line.length > 0) {
      return line;
    }
  }
  return null;
}

interface ShellPath {
  readonly entries: readonly string[];
  readonly outcome: LoginShellOutcome;
}

async function readLoginShellPath(request: PathRequest): Promise<ShellPath> {
  const shell = request.env[SHELL_ENV_VAR];
  if (shell === undefined || shell.length === 0) {
    return { entries: [], outcome: { kind: "unavailable", reason: "SHELL names no login shell" } };
  }
  const result = await request.run({
    command: shell,
    args: LOGIN_SHELL_ARGS,
    env: request.env,
    cwd: null,
    timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
    maxOutputBytes: LOGIN_SHELL_OUTPUT_LIMIT_BYTES,
    signal: request.signal,
  });
  if (result.kind === "timed-out") {
    return {
      entries: [],
      outcome: {
        kind: "unavailable",
        reason: `${shell} did not print its PATH within ${result.timeoutMs} ms`,
      },
    };
  }
  if (result.kind === "spawn-failed") {
    return {
      entries: [],
      outcome: { kind: "unavailable", reason: `${shell} could not be run: ${result.message}` },
    };
  }
  if (result.code !== 0) {
    return {
      entries: [],
      outcome: { kind: "unavailable", reason: `${shell} exited ${result.code} reading its PATH` },
    };
  }
  const line = lastPathLine(result.stdout);
  if (line === null) {
    return {
      entries: [],
      outcome: { kind: "unavailable", reason: `${shell} printed no PATH` },
    };
  }
  return { entries: splitPath(line), outcome: { kind: "read", shell } };
}

let cached: Promise<MergedPath> | null = null;

async function resolveMergedPath(request: PathRequest): Promise<MergedPath> {
  const shellPath = await readLoginShellPath(request);
  const entries = [...new Set([...shellPath.entries, ...splitPath(request.env[PATH_ENV_VAR])])];
  return { entries, value: entries.join(delimiter), loginShell: shellPath.outcome };
}

// A GUI launch inherits none of the login shell's PATH, so the shell is asked once and the answer
// is merged into every spawn the app makes for the life of the process.
export function mergedPath(request: PathRequest): Promise<MergedPath> {
  cached ??= resolveMergedPath(request);
  return cached;
}
