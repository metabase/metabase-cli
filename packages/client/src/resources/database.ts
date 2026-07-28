import { z } from "zod";

import {
  Database,
  type DatabaseGetInclude,
  type DatabaseListInclude,
  type DatabaseSyncResult,
} from "../domain/database";
import { Table } from "../domain/table";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type PollOptions, pollUntil } from "../poll";

// `GET /api/database` is the one Metabase list endpoint that wraps its rows in a `{ data, total }`
// envelope and reports a real server count, so `ListResult.total` carries the server's number rather
// than the length of the rows in hand.
const DatabaseApiList = z
  .object({
    data: z.array(Database),
    total: z.number().int().nonnegative(),
  })
  .loose();

// The sync and rescan endpoints queue background work and answer a bare acknowledgement, so the id a
// caller reads back off the result is the one it asked about.
const DatabaseTaskAck = z.object({ status: z.literal("ok") });

const DatabaseApiSchemaList = z.array(z.string());

const DatabaseApiSchemaTableList = z.array(Table);

const SYNC_COMPLETE = "complete";

export interface DatabaseListParams {
  include?: DatabaseListInclude | undefined;
  saved?: boolean | undefined;
}

export interface DatabaseGetParams {
  include?: DatabaseGetInclude | undefined;
}

// Presence of `wait` is the choice to block: the schedule is the caller's, the terminal condition is
// the server's.
export interface DatabaseSyncSchemaParams {
  wait?: PollOptions | undefined;
}

export function databaseResource(transport: Transport) {
  /** List databases. `include` hydrates each database's tables; `saved` adds the Saved Questions virtual database. */
  async function list(
    params: DatabaseListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Database>> {
    const response = await transport.requestParsed(DatabaseApiList, "/api/database", {
      ...options,
      query: { include: params.include, saved: params.saved },
    });
    return { data: response.data, total: response.total };
  }

  /** Get one database by id. `include` hydrates its tables, and `tables.fields` their fields too. */
  async function get(
    id: number,
    params: DatabaseGetParams = {},
    options: RequestOptions = {},
  ): Promise<Database> {
    return transport.requestParsed(Database, `/api/database/${id}`, {
      ...options,
      query: { include: params.include },
    });
  }

  /** List the schema names in a database. */
  async function schemas(id: number, options: RequestOptions = {}): Promise<ListResult<string>> {
    const data = await transport.requestParsed(
      DatabaseApiSchemaList,
      `/api/database/${id}/schemas`,
      { ...options },
    );
    return { data, total: null };
  }

  /** List the tables one schema of a database holds. */
  async function schemaTables(
    id: number,
    schema: string,
    options: RequestOptions = {},
  ): Promise<ListResult<Table>> {
    const data = await transport.requestParsed(
      DatabaseApiSchemaTableList,
      `/api/database/${id}/schema/${encodeURIComponent(schema)}`,
      { ...options },
    );
    return { data, total: null };
  }

  /**
   * Trigger a manual schema sync for a database. The endpoint queues the sync and returns at once;
   * pass `wait` to poll the database until it reports its initial sync complete.
   */
  async function syncSchema(
    id: number,
    params: DatabaseSyncSchemaParams = {},
    options: RequestOptions = {},
  ): Promise<DatabaseSyncResult> {
    const ack = await transport.requestParsed(DatabaseTaskAck, `/api/database/${id}/sync_schema`, {
      ...options,
      method: "POST",
    });
    const wait = params.wait;
    if (wait === undefined) {
      return { id, status: ack.status };
    }
    const database = await pollUntil(
      async (signal) =>
        transport.requestParsed(Database, `/api/database/${id}`, { ...options, signal }),
      (candidate) => candidate.initial_sync_status === SYNC_COMPLETE,
      wait,
    );
    return { id, status: ack.status, initial_sync_status: database.initial_sync_status ?? null };
  }

  /** Trigger a rescan of the cached field values across a database. */
  async function rescanValues(
    id: number,
    options: RequestOptions = {},
  ): Promise<DatabaseSyncResult> {
    const ack = await transport.requestParsed(
      DatabaseTaskAck,
      `/api/database/${id}/rescan_values`,
      { ...options, method: "POST" },
    );
    return { id, status: ack.status };
  }

  return { list, get, schemas, schemaTables, syncSchema, rescanValues };
}
