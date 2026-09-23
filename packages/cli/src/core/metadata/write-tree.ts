import { createWriteStream, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ExtractedTree } from "./extract";

const EXPORT_FILE_NAME = "table_metadata.json";
const DATABASES_DIR_NAME = "databases";

interface SpoolOptions {
  signal: AbortSignal;
}

// The export can be arbitrarily large, so it lands on disk chunk by chunk and is read back whole
// only once it is complete.
export async function spoolExport(
  outDir: string,
  stream: ReadableStream<Uint8Array>,
  options: SpoolOptions,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const path = join(outDir, EXPORT_FILE_NAME);
  await pipeline(Readable.fromWeb(stream), createWriteStream(path), { signal: options.signal });
  return path;
}

// The `databases/` subtree is the extractor's alone, so it is replaced rather than merged: a table
// dropped from the warehouse leaves no stale file behind.
export async function writeExtractedTree(outDir: string, tree: ExtractedTree): Promise<string> {
  const root = join(outDir, DATABASES_DIR_NAME);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  for (const file of tree.files) {
    const target = join(root, ...file.path.split("/"));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
  }
  return root;
}
