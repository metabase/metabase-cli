import { readFile } from "node:fs/promises";

import { isFileNotFoundError } from "@metabase/client/errors";

import { fileNotFoundError } from "../../runtime/input";

export async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw fileNotFoundError(path);
    }
    throw error;
  }
}

export const bundleFlag = {
  bundle: {
    type: "string",
    description: "Built bundle file whose text replaces the body's `bundle`",
  },
} as const;

export async function withBundle<T extends object>(
  body: T,
  path: string | undefined,
): Promise<T | (T & { bundle: string })> {
  return path === undefined ? body : { ...body, bundle: await readTextFile(path) };
}
