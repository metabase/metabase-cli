import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import type { CsvFile } from "@metabase/client/resources/csv-upload";

import { fileNotFoundError } from "./input";

export function requireUploadFilePath(file: string | undefined): string {
  if (typeof file !== "string" || file.trim() === "") {
    throw new ConfigError("provide the CSV file to upload with --file <path>");
  }
  return file;
}

export async function readCsvFile(path: string): Promise<CsvFile> {
  try {
    const bytes = await readFile(path);
    return { filename: basename(path), bytes };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw fileNotFoundError(path);
    }
    throw error;
  }
}
