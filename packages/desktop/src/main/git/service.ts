import type { TrackedFiles } from "../../contracts/settings";

import {
  outputTail,
  type CommandResult,
  type RunCommand,
  type StartProcess,
} from "../process/spawn";

const GIT_BINARY = "git";

export const GIT_TIMEOUT_MS = 30_000;

export const GIT_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

export const TRACKED_FILE_LIMIT = 2000;

// A read must not take the optional index lock: a worktree the user has open in another tool would
// then race the app for it.
const READ_ONLY_ARGS = ["--no-optional-locks"] as const;

// Loose objects and refs are renamed into place without fsync by default, so an unclean shutdown
// can leave a zero-byte ref behind that every later fetch and push trips over.
const DURABLE_ARGS = ["-c", "core.fsync=objects,reference", "-c", "core.fsyncMethod=fsync"];

const NUL = "\0";

const STREAM_TAIL_CHARACTERS = 2_000;

interface GitAnswered {
  readonly kind: "answered";
  readonly stdout: string;
}

interface GitRefused {
  readonly kind: "refused";
  readonly code: number;
  readonly message: string;
}

interface GitUnavailable {
  readonly kind: "unavailable";
  readonly message: string;
}

export type GitOutcome = GitAnswered | GitRefused | GitUnavailable;

export class GitFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitFailure";
  }
}

export function gitText(outcome: GitOutcome): string {
  if (outcome.kind === "answered") {
    return outcome.stdout;
  }
  throw new GitFailure(outcome.message);
}

export function nulFields(stdout: string): string[] {
  return stdout.split(NUL).filter((field) => field.length > 0);
}

export function firstLine(stdout: string): string | null {
  const line = stdout.split("\n")[0]?.trim();
  return line === undefined || line.length === 0 ? null : line;
}

interface GitDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly run: RunCommand;
  readonly start: StartProcess;
  readonly signal: AbortSignal;
}

export const GIT_STREAM_TIMEOUT_MS = 120_000;

// A command that talks to a remote must fail when it needs a credential nobody can type, rather than
// wait on a terminal prompt the app never shows.
const NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" } as const;

function refusalMessage(args: readonly string[], result: CommandResult): string {
  const invocation = `git ${args.join(" ")}`;
  if (result.kind === "spawn-failed") {
    return `${invocation} could not be run: ${result.message}`;
  }
  if (result.kind === "timed-out") {
    return `${invocation} did not answer within ${result.timeoutMs} ms.`;
  }
  const tail = outputTail(result);
  const exit = `${invocation} exited ${result.code}.`;
  return tail === null ? exit : `${exit}\n${tail}`;
}

export class Git {
  constructor(private readonly deps: GitDeps) {}

  withEnv(overrides: NodeJS.ProcessEnv): Git {
    return new Git({ ...this.deps, env: { ...this.deps.env, ...overrides } });
  }

  read(cwd: string, args: readonly string[]): Promise<GitOutcome> {
    return this.invoke(cwd, [...READ_ONLY_ARGS, ...args]);
  }

  write(cwd: string, args: readonly string[]): Promise<GitOutcome> {
    return this.invoke(cwd, [...DURABLE_ARGS, ...args]);
  }

  // Only the tail is kept for the refusal message; the caller already forwarded every chunk.
  async stream(
    cwd: string,
    args: readonly string[],
    onOutput: (text: string) => void,
  ): Promise<GitOutcome> {
    const invocation = `git ${args.join(" ")}`;
    const started = this.deps.start({
      command: GIT_BINARY,
      args: [...DURABLE_ARGS, ...args],
      env: { ...this.deps.env, ...NO_PROMPT_ENV },
      cwd,
    });
    if (started.kind === "start-failed") {
      return { kind: "unavailable", message: `${invocation} could not be run: ${started.message}` };
    }
    let tail = "";
    const forward = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      tail = `${tail}${text}`.slice(-STREAM_TAIL_CHARACTERS);
      onOutput(text);
    };
    started.stdout.on("data", forward);
    started.stderr.on("data", forward);
    const stop = (): void => {
      void started.stop();
    };
    const timer = setTimeout(stop, GIT_STREAM_TIMEOUT_MS);
    this.deps.signal.addEventListener("abort", stop, { once: true });
    try {
      const exit = await started.exited;
      if (exit.kind === "failed") {
        return { kind: "unavailable", message: `${invocation} failed: ${exit.message}` };
      }
      if (exit.code === null) {
        return {
          kind: "unavailable",
          message: `${invocation} was stopped by ${String(exit.signal)} before it finished.`,
        };
      }
      if (exit.code !== 0) {
        const message = `${invocation} exited ${exit.code}.\n${tail.trim()}`;
        return { kind: "refused", code: exit.code, message };
      }
      return { kind: "answered", stdout: tail };
    } finally {
      clearTimeout(timer);
      this.deps.signal.removeEventListener("abort", stop);
    }
  }

  private async invoke(cwd: string, args: readonly string[]): Promise<GitOutcome> {
    const result = await this.deps.run({
      command: GIT_BINARY,
      args,
      env: this.deps.env,
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: GIT_OUTPUT_LIMIT_BYTES,
      signal: this.deps.signal,
    });
    if (result.kind !== "exited") {
      return { kind: "unavailable", message: refusalMessage(args, result) };
    }
    if (result.truncated) {
      return {
        kind: "unavailable",
        message: `git ${args.join(" ")} printed more than ${GIT_OUTPUT_LIMIT_BYTES} bytes, so its answer is incomplete.`,
      };
    }
    if (result.code !== 0) {
      return { kind: "refused", code: result.code, message: refusalMessage(args, result) };
    }
    return { kind: "answered", stdout: result.stdout };
  }
}

export interface Checkout {
  readonly branch: string | null;
  readonly head: string | null;
}

// A repository whose HEAD is detached names no branch, and one with no commit yet names neither;
// both are states the app reports rather than guesses around.
export async function readCheckout(git: Git, cwd: string): Promise<Checkout> {
  const head = await git.read(cwd, ["rev-parse", "HEAD"]);
  const branch = await git.read(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return {
    branch: branch.kind === "answered" ? firstLine(branch.stdout) : null,
    head: head.kind === "answered" ? firstLine(head.stdout) : null,
  };
}

export async function branchExists(git: Git, cwd: string, branch: string): Promise<boolean> {
  const outcome = await git.read(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (outcome.kind === "unavailable") {
    throw new GitFailure(outcome.message);
  }
  return outcome.kind === "answered";
}

export async function listBranches(git: Git, cwd: string): Promise<string[]> {
  const outcome = await git.read(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return gitText(outcome)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The checkout as it stands: what git tracks and the new files it does not ignore, less what was
// deleted from disk and not yet staged.
export async function listCheckoutFiles(
  git: Git,
  cwd: string,
  limit: number,
): Promise<TrackedFiles> {
  const listed = await git.read(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const removed = await git.read(cwd, ["ls-files", "-z", "--deleted"]);
  const deleted = new Set(nulFields(gitText(removed)));
  const present = new Set(nulFields(gitText(listed)));
  const paths = [...present].filter((path) => !deleted.has(path)).toSorted();
  return { paths: paths.slice(0, limit), truncated: paths.length > limit };
}
