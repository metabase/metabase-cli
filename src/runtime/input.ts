import { readFile } from "node:fs/promises";

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
    const piped = await readStdin();
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
    return await readStdin();
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

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}
