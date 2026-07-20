import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { ConfigError, isNotFoundError } from "../core/errors";

import { fileNotFoundError } from "./input";

const CSV_CONTENT_TYPE = "text/csv";

export interface CsvFile {
  filename: string;
  bytes: Uint8Array;
}

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
    if (isNotFoundError(error)) {
      throw fileNotFoundError(path);
    }
    throw error;
  }
}

export function buildCsvFormData(file: CsvFile): FormData {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: CSV_CONTENT_TYPE }), file.filename);
  return form;
}
