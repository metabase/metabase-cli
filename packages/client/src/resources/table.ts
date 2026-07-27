import { z } from "zod";

import { Table, TableQueryMetadata, type TableUpdateInput } from "../domain/table";
import type { UploadUpdateAction, UploadUpdateResult } from "../domain/upload";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

import { buildCsvFormData, type CsvFile } from "./csv-upload";

// `GET /api/table` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const TableApiList = z.array(Table);

const UPLOAD_UPDATE_PATHS: Record<UploadUpdateAction, string> = {
  append: "append-csv",
  replace: "replace-csv",
};

export function tableResource(transport: Transport) {
  /** List every table the caller can see, across all databases. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Table>> {
    const data = await transport.requestParsed(TableApiList, "/api/table", { ...options });
    return { data, total: null };
  }

  /** Get one table by id, without its fields. */
  async function get(id: number, options: RequestOptions = {}): Promise<Table> {
    return transport.requestParsed(Table, `/api/table/${id}`, { ...options });
  }

  /** Update a table by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TableUpdateInput,
    options: RequestOptions = {},
  ): Promise<Table> {
    return transport.requestParsed(Table, `/api/table/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Get a table by id with its fields hydrated — the metadata the query builder runs on. */
  async function queryMetadata(
    id: number,
    options: RequestOptions = {},
  ): Promise<TableQueryMetadata> {
    return transport.requestParsed(TableQueryMetadata, `/api/table/${id}/query_metadata`, {
      ...options,
    });
  }

  async function updateFromCsv(
    id: number,
    action: UploadUpdateAction,
    file: CsvFile,
    options: RequestOptions,
  ): Promise<UploadUpdateResult> {
    await transport.requestRaw(`/api/table/${id}/${UPLOAD_UPDATE_PATHS[action]}`, {
      ...options,
      method: "POST",
      body: buildCsvFormData(file),
      expectContentType: "binary",
    });
    return { table_id: id, action };
  }

  /**
   * Inserts the rows of an uploaded CSV file into the table identified by `id`. The table must have
   * been created by uploading a CSV file.
   *
   * The file may be at most 50 MB; larger uploads are rejected with a 413 response.
   */
  async function appendCsv(
    id: number,
    file: CsvFile,
    options: RequestOptions = {},
  ): Promise<UploadUpdateResult> {
    return updateFromCsv(id, "append", file, options);
  }

  /**
   * Replaces the contents of the table identified by `id` with the rows of an uploaded CSV file.
   * The table must have been created by uploading a CSV file.
   *
   * The file may be at most 50 MB; larger uploads are rejected with a 413 response.
   */
  async function replaceCsv(
    id: number,
    file: CsvFile,
    options: RequestOptions = {},
  ): Promise<UploadUpdateResult> {
    return updateFromCsv(id, "replace", file, options);
  }

  return { list, get, update, queryMetadata, appendCsv, replaceCsv };
}
