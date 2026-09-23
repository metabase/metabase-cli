import { spawn, type ChildProcess } from "node:child_process";

import { errorMessage } from "@metabase/client/errors";

const CANCELLED_MESSAGE = "the command was cancelled before it exited";

const TAIL_LIMIT_CHARACTERS = 400;

interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string | null;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal: AbortSignal;
}

// `truncated` says the command wrote more than `maxOutputBytes`, so the text below is a prefix and
// a caller that parses it is parsing half an answer.
interface CommandExited {
  readonly kind: "exited";
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

interface CommandSpawnFailed {
  readonly kind: "spawn-failed";
  readonly message: string;
}

interface CommandTimedOut {
  readonly kind: "timed-out";
  readonly timeoutMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export type CommandResult = CommandExited | CommandSpawnFailed | CommandTimedOut;

export type RunCommand = (request: SpawnRequest) => Promise<CommandResult>;

class CappedOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private dropped = false;

  constructor(private readonly limitBytes: number) {}

  append(chunk: Buffer): void {
    const room = this.limitBytes - this.size;
    if (room <= 0) {
      this.dropped = true;
      return;
    }
    const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
    this.dropped = this.dropped || kept.length < chunk.length;
    this.chunks.push(kept);
    this.size += kept.length;
  }

  get truncated(): boolean {
    return this.dropped;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function collect(stream: NodeJS.ReadableStream | null, into: CappedOutput): void {
  if (stream === null) {
    return;
  }
  stream.on("data", (chunk: Buffer) => {
    into.append(chunk);
  });
}

interface ChildRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string | null;
  readonly pipeStdin: boolean;
}

function startChild(request: ChildRequest): ChildProcess | Error {
  try {
    return spawn(request.command, [...request.args], {
      env: request.env,
      cwd: request.cwd === null ? undefined : request.cwd,
      stdio: [request.pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(errorMessage(error));
  }
}

export function runCommand(request: SpawnRequest): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    if (request.signal.aborted) {
      resolve({ kind: "spawn-failed", message: CANCELLED_MESSAGE });
      return;
    }
    const child = startChild({
      command: request.command,
      args: request.args,
      env: request.env,
      cwd: request.cwd,
      pipeStdin: false,
    });
    if (child instanceof Error) {
      resolve({ kind: "spawn-failed", message: child.message });
      return;
    }

    const stdout = new CappedOutput(request.maxOutputBytes);
    const stderr = new CappedOutput(request.maxOutputBytes);
    collect(child.stdout, stdout);
    collect(child.stderr, stderr);

    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = (): void => {
      child.kill("SIGKILL");
      finish({ kind: "spawn-failed", message: CANCELLED_MESSAGE });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        kind: "timed-out",
        timeoutMs: request.timeoutMs,
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
      });
    }, request.timeoutMs);
    request.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      finish({ kind: "spawn-failed", message: error.message });
    });
    child.on("close", (code, signal) => {
      if (code === null) {
        finish({
          kind: "spawn-failed",
          message: `${request.command} was terminated by ${signal ?? "an unknown signal"}`,
        });
        return;
      }
      finish({
        kind: "exited",
        code,
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
      });
    });
  });
}

export function outputTail(result: CommandExited | CommandTimedOut): string | null {
  for (const text of [result.stderr, result.stdout]) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(-TAIL_LIMIT_CHARACTERS);
    }
  }
  return null;
}

const FORCE_KILL_AFTER_MS = 2_000;

const NO_PIPES_MESSAGE = "the process was started without the pipes the caller needs";

export interface StreamingRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

interface ProcessExited {
  readonly kind: "exited";
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ProcessFailed {
  readonly kind: "failed";
  readonly message: string;
}

export type ProcessExit = ProcessExited | ProcessFailed;

export interface RunningProcess {
  readonly kind: "running";
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exited: Promise<ProcessExit>;
  stop(): Promise<ProcessExit>;
}

export interface ProcessStartFailed {
  readonly kind: "start-failed";
  readonly message: string;
}

export type StartProcessResult = RunningProcess | ProcessStartFailed;

export type StartProcess = (request: StreamingRequest) => StartProcessResult;

// A spawn that cannot reach its binary fails on the event loop, not at the call, so the caller
// learns about it through the same promise that reports an ordinary exit.
function exitOf(child: ChildProcess): Promise<ProcessExit> {
  return new Promise<ProcessExit>((resolve) => {
    child.on("error", (error) => {
      resolve({ kind: "failed", message: error.message });
    });
    child.on("close", (code, signal) => {
      resolve({ kind: "exited", code, signal });
    });
  });
}

export function startProcess(request: StreamingRequest): StartProcessResult {
  const child = startChild({
    command: request.command,
    args: request.args,
    env: request.env,
    cwd: request.cwd,
    pipeStdin: true,
  });
  if (child instanceof Error) {
    return { kind: "start-failed", message: child.message };
  }
  const { stdin, stdout, stderr } = child;
  if (stdin === null || stdout === null || stderr === null) {
    child.kill("SIGKILL");
    return { kind: "start-failed", message: NO_PIPES_MESSAGE };
  }
  const exited = exitOf(child);
  return {
    kind: "running",
    stdin,
    stdout,
    stderr,
    exited,
    stop: async (): Promise<ProcessExit> => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      const forced = setTimeout(() => {
        child.kill("SIGKILL");
      }, FORCE_KILL_AFTER_MS);
      forced.unref();
      try {
        return await exited;
      } finally {
        clearTimeout(forced);
      }
    },
  };
}
