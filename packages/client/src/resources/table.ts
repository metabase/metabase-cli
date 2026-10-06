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
import { ConfigError, PartialWriteError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import type { FeatureName } from "../version/features";
import { explainer } from "../version/refusal";
import type { ParameterRequirement } from "../version/requirement-check";

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
// filter that arrived after the oldest supported major is refused by name before the wire. Every
// server applies such a filter only when it is `true`, so a `false` one reads the same dropped or
// not and needs no feature.
const LIST_PARAM_FEATURES: ReadonlyArray<readonly [keyof TableListParams, FeatureName]> = [
  ["can-query", "tableListAccessFilters"],
  ["can-write", "tableListAccessFilters"],
  ["include-transform-targets", "tableListTransformTargets"],
  ["unused-only", "tableUnusedFilter"],
  ["published-only", "tableListPublishedFilter"],
];

function listParamFeatures(params: TableListParams): FeatureName[] {
  return LIST_PARAM_FEATURES.filter(([param]) => params[param] === true).map(
    ([, feature]) => feature,
  );
}

// A server older than the tier vocabulary rejects a tier name with a 400 naming the request field
// it travels in: `data-layer` on the list filter, `data_layer` on an update.
function dataLayerFeatures(
  value: TableDataLayer | null | undefined,
  field: string,
): ParameterRequirement[] {
  const isTierName =
    value !== null && value !== undefined && TableDataLayerTier.safeParse(value).success;
  return isTierName ? [{ feature: "tableDataLayerTiers", fields: [field] }] : [];
}

const UPLOAD_UPDATE_PATHS: Record<UploadUpdateAction, string> = {
  append: "append-csv",
  replace: "replace-csv",
};

export function tableResource(transport: Transport) {
  const { explain } = explainer(transport, "table");

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
    await transport.requireFeatures(listParamFeatures(params), options);
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
    return transport.requestParsed(Table, `/api/table/${id}`, { ...options });
  }

  /** Update a table by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TableUpdateInput,
    options: RequestOptions = {},
  ): Promise<Table> {
    await refuseRewrittenDataLayer(params.data_layer, options);
    await requireDataAuthorityNull(params.data_authority, options);
    const path = `/api/table/${id}`;
    const updated = await transport.requestParsed(Table, path, {
      ...options,
      method: "PUT",
      body: params,
    });
    assertCollectionWritten(path, params.collection_id, updated);
    return updated;
  }

  // A server that names tiers maps a medallion name onto one on update without a word, and for
  // `copper` leaves the table visible while storing it hidden, so the name is refused by value
  // before the wire. A tier name on an older server is that server's own 400. The list filter needs
  // no such check: every server validates it against its own vocabulary and answers 400 naming it.
  async function refuseRewrittenDataLayer(
    value: TableDataLayer | null | undefined,
    options: RequestOptions,
  ): Promise<void> {
    if (value === null || value === undefined || TableDataLayerTier.safeParse(value).success) {
      return;
    }
    const { features } = await transport.verifiedServer(options);
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
    await requireDataAuthorityNull(params.data_authority, options);
    await transport.requestParsed(BulkEditResponse, BULK_EDIT_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
    return { accepted: true, ...params };
  }

  // A server that keeps `data_authority` on the table itself, where the column is NOT NULL, has no
  // `null` to store: the single-table update and the bulk edit both hand it to that column, and
  // the database fails the write as a bare 500, or an app database that coerces NULL stores
  // something other than a withdrawal. Neither names the cause, so it is refused here.
  async function requireDataAuthorityNull(
    value: TableUpdateInput["data_authority"],
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

  return {
    list: explain("list", list, (params) =>
      dataLayerFeatures(params?.["data-layer"], "data-layer"),
    ),
    get,
    update: explain("update", update, (_id, params) =>
      dataLayerFeatures(params.data_layer, "data_layer"),
    ),
    queryMetadata,
    fks,
    syncSchema,
    rescanValues,
    discardValues,
    bulkEdit: explain("bulkEdit", bulkEdit),
    bulkSyncSchema: explain("bulkSyncSchema", bulkSyncSchema),
    bulkRescanValues: explain("bulkRescanValues", bulkRescanValues),
    bulkDiscardValues: explain("bulkDiscardValues", bulkDiscardValues),
    appendCsv,
    replaceCsv,
  };
}

// A server whose update predates publishing a table takes `collection_id` in its open body, leaves
// it out of the columns it writes, and answers 200 with the table where it was. Which servers do
// is a matter of patch release, not major, so the table the server answers is the judge.
function assertCollectionWritten(
  path: string,
  requested: TableUpdateInput["collection_id"],
  table: Table,
): void {
  if (requested === undefined || table.collection_id === requested) {
    return;
  }
  const answered = table.collection_id;
  const stayed =
    answered === null || answered === undefined ? "in no collection" : `in collection ${answered}`;
  throw new PartialWriteError(
    `the server applied the rest of the update to table ${table.id} but not collection_id: the table stays ${stayed}, because this server does not move a table to a collection through an update`,
    { method: "PUT", path, field: "collection_id", requested, answered },
  );
}
