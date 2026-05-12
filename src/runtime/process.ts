import { spawn } from "node:child_process";

import { isNotFoundError } from "../core/errors";

export interface ProcessRunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdin?: string | Uint8Array;
  timeoutMs?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ProcessBinaryResult {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number | null;
}

export class ProcessNotFoundError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`command not found: ${command}`);
    this.name = "ProcessNotFoundError";
    this.command = command;
  }
}

export class ProcessTimeoutError extends Error {
  readonly command: string;
  readonly timeoutMs: number;
  constructor(command: string, timeoutMs: number) {
    super(`command timed out after ${timeoutMs}ms: ${command}`);
    this.name = "ProcessTimeoutError";
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}

function spawnAndCollect(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
): Promise<ProcessBinaryResult> {
  const timeoutSignal =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(timeoutSignal !== undefined ? { signal: timeoutSignal, killSignal: "SIGKILL" } : {}),
    });

    const stdoutChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: unknown) => {
      if (isNotFoundError(error)) {
        reject(new ProcessNotFoundError(command));
        return;
      }
      if (timeoutSignal?.aborted) {
        reject(new ProcessTimeoutError(command, options.timeoutMs ?? 0));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (timeoutSignal?.aborted) {
        reject(new ProcessTimeoutError(command, options.timeoutMs ?? 0));
        return;
      }
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      resolve({
        stdout: new Uint8Array(stdoutBuffer.buffer, stdoutBuffer.byteOffset, stdoutBuffer.length),
        stderr,
        exitCode: code,
      });
    });

    if (options.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(options.stdin);
    }
  });
}

const stdoutDecoder = new TextDecoder("utf-8");

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): Promise<ProcessResult> {
  const result = await spawnAndCollect(command, args, options);
  return {
    stdout: stdoutDecoder.decode(result.stdout),
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export function runProcessBinary(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {},
): Promise<ProcessBinaryResult> {
  return spawnAndCollect(command, args, options);
}

export function streamProcess(command: string, args: readonly string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error: unknown) => {
      if (isNotFoundError(error)) {
        reject(new ProcessNotFoundError(command));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve(code));
  });
}
