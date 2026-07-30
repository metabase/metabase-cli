import { UploadResult } from "../domain/upload";
import { ResponseShapeError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";

import { buildCsvFormData, type CsvFile } from "./csv-upload";

const UPLOAD_TABLE_ID_HEADER = "metabase-table-id";

export interface UploadCsvParams {
  collection_id: string;
}

export function uploadResource(transport: Transport) {
  /**
   * Create a table and model populated with the values from the attached CSV. Returns the model ID
   * if successful.
   *
   * The file may be at most 50 MB; larger uploads are rejected with a 413 response.
   */
  async function createFromCsv(
    file: CsvFile,
    params: UploadCsvParams,
    options: RequestOptions = {},
  ): Promise<UploadResult> {
    const form = buildCsvFormData(file);
    form.append("collection_id", params.collection_id);
    const response = await transport.requestRaw("/api/upload/csv", {
      ...options,
      method: "POST",
      body: form,
      expectContentType: "binary",
    });
    return parseCreateUploadResult(await response.text(), response.headers);
  }

  return { createFromCsv };
}

function parseCreateUploadResult(bodyText: string, headers: Headers): UploadResult {
  return UploadResult.parse({
    model_id: parseResponseInteger(bodyText, "response body"),
    table_id: parseResponseInteger(
      headers.get(UPLOAD_TABLE_ID_HEADER),
      `${UPLOAD_TABLE_ID_HEADER} header`,
    ),
  });
}

function parseResponseInteger(value: string | null, source: string): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    throw new ResponseShapeError(`upload succeeded but the ${source} was empty`, {
      kind: "decoded",
      source,
      value,
    });
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new ResponseShapeError(
      `upload succeeded but the ${source} was not an integer: ${JSON.stringify(trimmed)}`,
      { kind: "decoded", source, value },
    );
  }
  return parsed;
}
