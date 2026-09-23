import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { isFileNotFoundError } from "@metabase/client/errors";

import type { FilePreview } from "../../contracts/files";

import { SessionCommandError } from "./errors";

export const PREVIEW_BYTE_LIMIT = 512 * 1024;

// git's own test for a binary file: a NUL byte among the first 8000.
const BINARY_PROBE_BYTES = 8000;
const NUL_BYTE = 0;
const PARENT_SEGMENT = "..";

function isInside(root: string, path: string): boolean {
  const rest = relative(root, path);
  const escapes = rest === PARENT_SEGMENT || rest.startsWith(`${PARENT_SEGMENT}${sep}`);
  return rest.length > 0 && !escapes && !isAbsolute(rest);
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

// `path` is already relative to the checkout; a symlink is followed only while it stays inside.
export async function readPreview(root: string, path: string): Promise<FilePreview> {
  const resolved = await realpathOrNull(join(root, path));
  if (resolved === null) {
    return { kind: "gone", path };
  }
  if (!isInside(await realpath(root), resolved)) {
    throw new SessionCommandError(`${path} leads outside the session's checkout.`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new SessionCommandError(`${path} is not a file.`);
  }
  if (info.size > PREVIEW_BYTE_LIMIT) {
    return { kind: "too-large", path, bytes: info.size, limit: PREVIEW_BYTE_LIMIT };
  }
  const bytes = await readFile(resolved);
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(NUL_BYTE)) {
    return { kind: "binary", path, bytes: bytes.length };
  }
  return { kind: "text", path, text: bytes.toString("utf8") };
}
