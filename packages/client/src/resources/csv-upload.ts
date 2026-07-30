const CSV_CONTENT_TYPE = "text/csv";

// The bytes and the name Metabase records for them. Where they came from — a path, a stream, a
// buffer built in memory — is the caller's, and the client never reads a filesystem to find out.
export interface CsvFile {
  filename: string;
  bytes: Uint8Array;
}

export function buildCsvFormData(file: CsvFile): FormData {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: CSV_CONTENT_TYPE }), file.filename);
  return form;
}
