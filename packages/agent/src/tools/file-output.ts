import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInputPath } from "./file-input";

const JSON_FILE_INDENT = 2;

export async function writeTextFileOutput(
  cwd: string,
  path: string,
  text: string,
): Promise<string> {
  const resolved = resolveInputPath(cwd, path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, text, "utf8");
  return resolved;
}

export async function writeJsonFileOutput(
  cwd: string,
  path: string,
  value: unknown,
): Promise<string> {
  return writeTextFileOutput(cwd, path, JSON.stringify(value, null, JSON_FILE_INDENT) + "\n");
}
