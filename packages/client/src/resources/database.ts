import { z } from "zod";

import { Database, type DatabaseGetInclude, type DatabaseListInclude } from "../domain/database";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/database` is the one Metabase list endpoint that wraps its rows in a `{ data, total }`
// envelope and reports a real server count, so `ListResult.total` carries the server's number rather
// than the length of the rows in hand.
const DatabaseApiList = z
  .object({
    data: z.array(Database),
    total: z.number().int().nonnegative(),
  })
  .loose();

export interface DatabaseListParams {
  include?: DatabaseListInclude | undefined;
  saved?: boolean | undefined;
}

export interface DatabaseGetParams {
  include?: DatabaseGetInclude | undefined;
}

export function databaseResource(transport: Transport) {
  /** List databases. `include` hydrates each database's tables; `saved` adds the Saved Questions virtual database. */
  async function list(
    params: DatabaseListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Database>> {
    await transport.require("database.list", options);
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
    await transport.require("database.get", options);
    return transport.requestParsed(Database, `/api/database/${id}`, {
      ...options,
      query: { include: params.include },
    });
  }

  return { list, get };
}
