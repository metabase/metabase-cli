import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { ConfigError, errorMessage, isFileNotFoundError } from "@metabase/client/errors";
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

export async function readFixtureFile(path: string, label: string): Promise<CsvFile> {
  try {
    const bytes = await readFile(path);
    return { filename: basename(path), bytes };
  } catch (error) {
    throw new ConfigError(`Cannot read ${label} file '${path}': ${errorMessage(error)}`);
  }
}
