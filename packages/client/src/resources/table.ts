import { z } from "zod";

import {
  Table,
  type TableBulkEditInput,
  type TableDataLayer,
  TableDataLayerTier,
  type TableDataSource,
  TableForeignKey,
  TableQueryMetadata,
  type TableUpdateInput,
} from "../domain/table";
import type { UploadUpdateAction, UploadUpdateResult } from "../domain/upload";
import { ConfigError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import type { FeatureName } from "../version/features";

import { buildCsvFormData, type CsvFile } from "./csv-upload";
import { fetchOptionalParsed } from "./optional-parsed";

// `GET /api/table` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const TableApiList = z.array(Table);

const TableApiFks = z.array(TableForeignKey);

const SyncSchemaResponse = z.object({ status: z.literal("ok") });
const RescanValuesResponse = z.object({ status: z.literal("success") });
const BulkEditResponse = z.object({});

const BULK_EDIT_PATH = "/api/data-studio/table/edit";

export interface TableListParams {
  term?: string | undefined;
  "visibility-type"?: string | undefined;
  "data-layer"?: TableDataLayer | undefined;
  "data-source"?: TableDataSource | undefined;
  "owner-user-id"?: number | undefined;
  "owner-email"?: string | undefined;
  "orphan-only"?: boolean | undefined;
  "unused-only"?: boolean | undefined;
  "can-query"?: boolean | undefined;
  "can-write"?: boolean | undefined;
  "include-transform-targets"?: boolean | undefined;
}

// Older servers leave the query map open and drop a filter they do not know without a word, so a
// filter that arrived after the oldest supported major is refused by name before the wire.
const LIST_PARAM_FEATURES: ReadonlyArray<readonly [keyof TableListParams, FeatureName]> = [
  ["can-query", "tableListAccessFilters"],
  ["can-write", "tableListAccessFilters"],
  ["include-transform-targets", "tableListTransformTargets"],
  ["unused-only", "tableUnusedFilter"],
];

function listParamFeatures(params: TableListParams): FeatureName[] {
  return LIST_PARAM_FEATURES.filter(([param]) => params[param] !== undefined).map(
    ([, feature]) => feature,
  );
}

const UPLOAD_UPDATE_PATHS: Record<UploadUpdateAction, string> = {
  append: "append-csv",
  replace: "replace-csv",
};

export function tableResource(transport: Transport) {
  /**
   * List every table the caller can see, across all databases. `term` matches names and display
   * names; `can-query` and `can-write` keep only the tables the caller may query or edit the
   * metadata of; `include-transform-targets` adds tables a transform writes to; `unused-only` keeps
   * tables nothing depends on.
   */
  async function list(
    params: TableListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Table>> {
    await transport.require("table.list", options);
    await transport.requireFeatures(listParamFeatures(params), options);
    await requireDataLayer(params["data-layer"], options);
    const data = await transport.requestParsed(TableApiList, "/api/table", {
      ...options,
      query: {
        term: params.term,
        "visibility-type": params["visibility-type"],
        "data-layer": params["data-layer"],
        "data-source": params["data-source"],
        "owner-user-id": params["owner-user-id"],
        "owner-email": params["owner-email"],
        "orphan-only": params["orphan-only"],
        "unused-only": params["unused-only"],
        "can-query": params["can-query"],
        "can-write": params["can-write"],
        "include-transform-targets": params["include-transform-targets"],
      },
    });
    return { data, total: null };
  }

  /** Get one table by id, without its fields. */
  async function get(id: number, options: RequestOptions = {}): Promise<Table> {
    await transport.require("table.get", options);
    return transport.requestParsed(Table, `/api/table/${id}`, { ...options });
  }

  /** Update a table by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TableUpdateInput,
    options: RequestOptions = {},
  ): Promise<Table> {
    await transport.require("table.update", options);
    await requireDataLayer(params.data_layer, options);
    return transport.requestParsed(Table, `/api/table/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  // A tier name is refused below 59 by feature; a medallion name is refused from 59 on by value,
  // because a requirement can only say a server is too old, never too new.
  async function requireDataLayer(
    value: TableDataLayer | null | undefined,
    options: RequestOptions,
  ): Promise<void> {
    if (value === null || value === undefined) {
      return;
    }
    if (TableDataLayerTier.safeParse(value).success) {
      await transport.requireFeatures(["tableDataLayerTiers"], options);
      return;
    }
    const { features } = await transport.server(options);
    if (features.tableDataLayerTiers) {
      throw new ConfigError(
        `data_layer "${value}" is a Metabase 58 name; this server names a table's layer ${TableDataLayerTier.options.join(", ")}`,
      );
    }
  }

  /** Get a table by id with its fields hydrated — the metadata the query builder runs on. */
  async function queryMetadata(
    id: number,
    options: RequestOptions = {},
  ): Promise<TableQueryMetadata> {
    await transport.require("table.queryMetadata", options);
    return transport.requestParsed(TableQueryMetadata, `/api/table/${id}/query_metadata`, {
      ...options,
    });
  }

  /**
   * Get every foreign key whose destination is a field of this table. A table with no active
   * fields answers no content, which is the same empty list.
   */
  async function fks(
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<TableForeignKey>> {
    await transport.require("table.fks", options);
    const data = await fetchOptionalParsed(transport, `/api/table/${id}/fks`, TableApiFks, {
      ...options,
    });
    return { data: data ?? [], total: null };
  }

  /**
   * Trigger a manual update of this table's schema metadata. The sync runs after the call returns;
   * a warehouse the server cannot connect to is a 422.
   */
  async function syncSchema(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("table.syncSchema", options);
    await transport.requestParsed(SyncSchemaResponse, `/api/table/${id}/sync_schema`, {
      ...options,
      method: "POST",
    });
  }

  /**
   * Trigger an update of the field values of every eligible field of this table. The scan runs
   * after the call returns.
   */
  async function rescanValues(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("table.rescanValues", options);
    await transport.requestParsed(RescanValuesResponse, `/api/table/${id}/rescan_values`, {
      ...options,
      method: "POST",
    });
  }

  /**
   * Set the same metadata on every table the selectors pick out. A table leaving the `hidden` data
   * layer is re-synced after the call returns.
   */
  async function bulkEdit(params: TableBulkEditInput, options: RequestOptions = {}): Promise<void> {
    await transport.require("table.bulkEdit", options);
    await transport.requestParsed(BulkEditResponse, BULK_EDIT_PATH, {
      ...options,
      method: "POST",
      body: params,
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
    await transport.require("table.appendCsv", options);
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
    await transport.require("table.replaceCsv", options);
    return updateFromCsv(id, "replace", file, options);
  }

  return {
    list,
    get,
    update,
    queryMetadata,
    fks,
    syncSchema,
    rescanValues,
    bulkEdit,
    appendCsv,
    replaceCsv,
  };
}
