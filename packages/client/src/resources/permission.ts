import {
  PermissionsGraph,
  PermissionsGraphRevision,
  PermissionsGraphUpdateInput,
} from "../domain/permission";
import type { RequestOptions, Transport } from "../http/transport";

import { parseRequestBody } from "./request-body";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function permissionResource(transport: Transport) {
  /**
   * Get the data permissions of every group on every database, keyed by group id then database
   * id. Admin only. One read of the whole `data_permissions` table, so prefer `databaseGraph` when
   * one database is the question.
   */
  async function graph(options: RequestOptions = {}): Promise<PermissionsGraph> {
    return transport.requestParsed(PermissionsGraph, "/api/permissions/graph", { ...options });
  }

  /**
   * Get the data permissions of every group on one database. Admin only. The read is filtered to
   * that database, so this is the cheapest way to learn which groups can query a table: look the
   * group up under the database and read `view-data` and `create-queries` down to the table id.
   */
  async function databaseGraph(
    id: number,
    options: RequestOptions = {},
  ): Promise<PermissionsGraph> {
    return transport.requestParsed(PermissionsGraph, `/api/permissions/graph/db/${id}`, {
      ...options,
    });
  }

  /** Get the data permissions of one group on every database. Admin only. */
  async function groupGraph(id: number, options: RequestOptions = {}): Promise<PermissionsGraph> {
    return transport.requestParsed(PermissionsGraph, `/api/permissions/graph/group/${id}`, {
      ...options,
    });
  }

  /**
   * Update data permissions. Admin only. Only the groups and databases named in `groups` change, and the server
   * rejects the update when `revision` is not its latest, so a change made since the graph was read
   * is never overwritten. Asks the server not to answer the whole graph; answers the new revision.
   * A body that does not match `PermissionsGraphUpdateInput` is refused before any request.
   */
  async function updateGraph(
    params: PermissionsGraphUpdateInput,
    options: RequestOptions = {},
  ): Promise<PermissionsGraphRevision> {
    const body = parseRequestBody(PermissionsGraphUpdateInput, params, "permissions graph update");
    return transport.requestParsed(PermissionsGraphRevision, "/api/permissions/graph", {
      ...options,
      method: "PUT",
      query: { "skip-graph": true },
      body,
    });
  }

  return { graph, databaseGraph, groupGraph, updateGraph };
}
