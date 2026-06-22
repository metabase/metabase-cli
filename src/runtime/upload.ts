import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { ConfigError, errorMessage } from "../core/errors";

export interface FilePart {
  blob: Blob;
  filename: string;
}

export async function readFilePart(path: string, label: string): Promise<FilePart> {
  try {
    const bytes = await readFile(path);
    return { blob: new Blob([bytes]), filename: basename(path) };
  } catch (error) {
    throw new ConfigError(`Cannot read ${label} file '${path}': ${errorMessage(error)}`);
  }
}
