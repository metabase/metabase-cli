import type { Client } from "../../core/http/client";
import { buildCsvFormData, type CsvFile } from "../../runtime/upload";

import { UploadResult, type UploadUpdateAction, type UploadUpdateResult } from "./results";

export const UPLOAD_TABLE_ID_HEADER = "metabase-table-id";

const UPLOAD_UPDATE_PATHS: Record<UploadUpdateAction, string> = {
  append: "append-csv",
  replace: "replace-csv",
};

export async function updateTableFromCsv(
  client: Client,
  tableId: number,
  action: UploadUpdateAction,
  file: CsvFile,
): Promise<UploadUpdateResult> {
  await client.requestRaw(`/api/table/${tableId}/${UPLOAD_UPDATE_PATHS[action]}`, {
    method: "POST",
    body: buildCsvFormData(file),
    expectContentType: "binary",
  });
  return { table_id: tableId, action };
}

export function parseCreateUploadResult(bodyText: string, headers: Headers): UploadResult {
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
    throw new Error(`upload succeeded but the ${source} was empty`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new Error(
      `upload succeeded but the ${source} was not an integer: ${JSON.stringify(trimmed)}`,
    );
  }
  return parsed;
}
