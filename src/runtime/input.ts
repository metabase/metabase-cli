import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { ConfigError, isNotFoundError } from "../core/errors";

export interface InputSources {
  flag?: string | undefined;
  file?: string | undefined;
  positional?: string | undefined;
  required?: boolean | undefined;
  flagName?: string | undefined;
}

export const DEFAULT_FLAG_NAME = "--body";

function sourceList(flagName: string | undefined): string {
  return `${flagName ?? DEFAULT_FLAG_NAME}, --file, stdin, or a positional argument`;
}

export async function readInput(sources: InputSources): Promise<string> {
  if (sources.flag) {
    return sources.flag;
  }
  if (sources.file) {
    return await readFileSource(sources.file);
  }

  if (!process.stdin.isTTY) {
    const piped = await readPipedStdin();
    if (piped) {
      return piped;
    }
  }

  if (sources.positional) {
    return sources.positional;
  }

  const required = sources.required ?? true;
  if (required) {
    throw new ConfigError(`input required: provide one of ${sourceList(sources.flagName)}`);
  }
  return "";
}

async function readFileSource(path: string): Promise<string> {
  if (path === "-") {
    return await drainStdin();
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ConfigError(`--file not found: ${path}`);
    }
    throw error;
  }
}

async function drainStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

const STDIN_FIRST_CHUNK_TIMEOUT_MS = 500;
const STDIN_IDLE = Symbol("stdin-idle");

// A non-TTY stdin we were never asked to read may be an inherited pipe that holds
// the fd open without ever sending data or EOF — draining it blocks forever. So we
// race only the first chunk against a deadline: nothing in time means release stdin
// and report no input; once a chunk arrives we drain in full, so a large or slow
// body is never truncated. Explicit stdin (`--file -`) skips this and blocks — there
// the caller has promised data.
async function readPipedStdin(): Promise<string | null> {
  const iterator = process.stdin[Symbol.asyncIterator]();
  const controller = new AbortController();
  const idle = delay(STDIN_FIRST_CHUNK_TIMEOUT_MS, STDIN_IDLE, {
    signal: controller.signal,
  }).catch(() => STDIN_IDLE);

  const first = await Promise.race([iterator.next(), idle]);
  if (typeof first === "symbol") {
    process.stdin.pause();
    process.stdin.unref();
    return null;
  }
  controller.abort();

  let data = "";
  let chunk = first;
  while (chunk.done !== true) {
    data += chunk.value;
    chunk = await iterator.next();
  }
  return data;
}
