import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

const TEMP_DIR_PREFIX = "metabase-workspace-";
const SECURE_FILE_MODE = 0o600;

// mkdtemp(3) creates the directory with mode 0700 by POSIX contract — no chmod needed.
export async function mkSecureTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
}

export async function writeSecureFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: SECURE_FILE_MODE });
}

export async function streamToSecureFile(
  source: ReadableStream<Uint8Array>,
  path: string,
): Promise<void> {
  const writable = createWriteStream(path, { mode: SECURE_FILE_MODE });
  await source.pipeTo(Writable.toWeb(writable));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
