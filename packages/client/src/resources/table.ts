import { z } from "zod";

import {
  Table,
  type TableBulkEditInput,
  type TableBulkEditResult,
  type TableDataLayer,
  TableDataLayerTier,
  type TableDataSource,
  TableForeignKey,
  TableQueryMetadata,
  type TableFieldValuesResult,
  type TableSchemaSyncResult,
  type TableSelectionResult,
  TableSelectors,
  type TableUpdateInput,
} from "../domain/table";
import type { UploadUpdateAction, UploadUpdateResult } from "../domain/upload";
import { ConfigError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import type { FeatureName } from "../version/features";

import { buildCsvFormData, type CsvFile } from "./csv-upload";
import { fetchOptionalParsed } from "./optional-parsed";
import { parseRequestBody } from "./request-body";

// `GET /api/table` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const TableApiList = z.array(Table);

const TableApiFks = z.array(TableForeignKey);

const SyncSchemaResponse = z.object({ status: z.literal("ok") });
const FieldValuesResponse = z.object({ status: z.literal("success") });
const BulkEditResponse = z.object({});

const BULK_EDIT_PATH = "/api/data-studio/table/edit";
const BULK_SYNC_SCHEMA_PATH = "/api/data-studio/table/sync-schema";
const BULK_RESCAN_VALUES_PATH = "/api/data-studio/table/rescan-values";
const BULK_DISCARD_VALUES_PATH = "/api/data-studio/table/discard-values";

export interface TableListParams {
  term?: string | undefined;
  "visibility-type"?: string | undefined;
  "data-layer"?: TableDataLayer | undefined;
  "data-source"?: TableDataSource | undefined;
  "owner-user-id"?: number | undefined;
  "owner-email"?: string | undefined;
  "orphan-only"?: boolean | undefined;
  "unused-only"?: boolean | undefined;
  "published-only"?: boolean | undefined;
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
  ["published-only", "tableListPublishedFilter"],
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
   * tables nothing depends on; `published-only` keeps tables published to the library.
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
        "published-only": params["published-only"],
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
        `data_layer "${value}" is a medallion name; this server names a table's layer ${TableDataLayerTier.options.join(", ")}`,
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
   * Trigger a sync of this table: its columns, their fingerprints and its cached field values. It
   * never discovers new tables. The sync runs after the call returns; a warehouse the server cannot
   * connect to is a 422.
   */
  async function syncSchema(
    id: number,
    options: RequestOptions = {},
  ): Promise<TableSchemaSyncResult> {
    await transport.require("table.syncSchema", options);
    const ack = await transport.requestParsed(SyncSchemaResponse, `/api/table/${id}/sync_schema`, {
      ...options,
      method: "POST",
    });
    return { id, status: ack.status };
  }

  /**
   * Trigger an update of the field values of every eligible field of this table that already has a
   * cached set. The scan runs after the call returns.
   */
  async function rescanValues(
    id: number,
    options: RequestOptions = {},
  ): Promise<TableFieldValuesResult> {
    await transport.require("table.rescanValues", options);
    const ack = await transport.requestParsed(
      FieldValuesResponse,
      `/api/table/${id}/rescan_values`,
      { ...options, method: "POST" },
    );
    return { id, status: ack.status };
  }

  /**
   * Discard the cached field values of every field of this table, custom display values included.
   * No scan recreates a discarded set; the server rebuilds it, without the display values, the next
   * time the field's values are read.
   */
  async function discardValues(
    id: number,
    options: RequestOptions = {},
  ): Promise<TableFieldValuesResult> {
    await transport.require("table.discardValues", options);
    const ack = await transport.requestParsed(
      FieldValuesResponse,
      `/api/table/${id}/discard_values`,
      { ...options, method: "POST" },
    );
    return { id, status: ack.status };
  }

  /**
   * Set the same metadata on every table the selectors pick out. A table leaving the `hidden` data
   * layer is re-synced after the call returns. The server answers the same whether or not the
   * selectors matched a table.
   */
  async function bulkEdit(
    params: TableBulkEditInput,
    options: RequestOptions = {},
  ): Promise<TableBulkEditResult> {
    await transport.require("table.bulkEdit", options);
    await requireDataAuthorityNull(params.data_authority, options);
    await transport.requestParsed(BulkEditResponse, BULK_EDIT_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
    return { accepted: true, ...params };
  }

  // A server that keeps `data_authority` on the table itself, where the column is NOT NULL, has no
  // `null` to store: the request fails there rather than withdrawing a value.
  async function requireDataAuthorityNull(
    value: TableBulkEditInput["data_authority"],
    options: RequestOptions,
  ): Promise<void> {
    if (value === null) {
      await transport.requireFeatures(["tableUserValueWithdrawal"], options);
    }
  }

  // The selector endpoints answer no body, whether or not the selectors matched a table, so a
  // malformed selector is refused here rather than acknowledged as a selection of nothing.
  async function postSelection(
    path: string,
    selectors: TableSelectors,
    options: RequestOptions,
  ): Promise<TableSelectionResult> {
    const body = parseRequestBody(TableSelectors, selectors, "table selectors");
    await transport.requestRaw(path, {
      ...options,
      method: "POST",
      body,
      expectContentType: "binary",
    });
    return { accepted: true, ...body };
  }

  /**
   * Trigger a sync of every table the selectors pick out: its columns, their fingerprints and its
   * cached field values. Every database behind them must answer a connection test first, or the
   * call is a 422; the syncs run after it returns.
   */
  async function bulkSyncSchema(
    selectors: TableSelectors,
    options: RequestOptions = {},
  ): Promise<TableSelectionResult> {
    await transport.require("table.bulkSyncSchema", options);
    return postSelection(BULK_SYNC_SCHEMA_PATH, selectors, options);
  }

  /**
   * Trigger a field-values rescan of every table the selectors pick out, refreshing the sets that
   * are already cached. The scans run after the call returns.
   */
  async function bulkRescanValues(
    selectors: TableSelectors,
    options: RequestOptions = {},
  ): Promise<TableSelectionResult> {
    await transport.require("table.bulkRescanValues", options);
    return postSelection(BULK_RESCAN_VALUES_PATH, selectors, options);
  }

  /**
   * Discard the cached field values of every table the selectors pick out, custom display values
   * included. No scan recreates a discarded set.
   */
  async function bulkDiscardValues(
    selectors: TableSelectors,
    options: RequestOptions = {},
  ): Promise<TableSelectionResult> {
    await transport.require("table.bulkDiscardValues", options);
    return postSelection(BULK_DISCARD_VALUES_PATH, selectors, options);
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
    discardValues,
    bulkEdit,
    bulkSyncSchema,
    bulkRescanValues,
    bulkDiscardValues,
    appendCsv,
    replaceCsv,
  };
}
