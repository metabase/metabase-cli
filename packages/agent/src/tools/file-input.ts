import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isNotFoundError } from "@metabase/cli/errors";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { TeachingError } from "./teaching-error";

export function resolveInputPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export async function readTextFileInput(cwd: string, path: string, label: string): Promise<string> {
  const resolved = resolveInputPath(cwd, path);
  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new TeachingError(`${label} "${path}" does not exist (resolved to ${resolved}).`);
    }
    throw error;
  }
  if (text.trim() === "") {
    throw new TeachingError(`${label} "${path}" is empty.`);
  }
  return text;
}

export async function readJsonFileInput(
  cwd: string,
  path: string,
  label: string,
): Promise<JsonValue> {
  const text = await readTextFileInput(cwd, path, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TeachingError(`${label} "${path}" is not valid JSON: ${reason}`);
  }
  return jsonValueSchema.parse(parsed);
}
