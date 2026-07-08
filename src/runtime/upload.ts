import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { ConfigError, errorMessage, isNotFoundError } from "../core/errors";

import { fileNotFoundError } from "./input";

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
