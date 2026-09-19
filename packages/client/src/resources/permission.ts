import { PermissionsGraph } from "../domain/permission";
import type { RequestOptions, Transport } from "../http/transport";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function permissionResource(transport: Transport) {
  /**
   * Get the data permissions of every group on every database, keyed by group id then database
   * id. Admin only. One read of the whole `data_permissions` table, so prefer `databaseGraph` when
   * one database is the question.
   */
  async function graph(options: RequestOptions = {}): Promise<PermissionsGraph> {
    await transport.require("permission.graph", options);
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
    await transport.require("permission.databaseGraph", options);
    return transport.requestParsed(PermissionsGraph, `/api/permissions/graph/db/${id}`, {
      ...options,
    });
  }

  /** Get the data permissions of one group on every database. Admin only. */
  async function groupGraph(id: number, options: RequestOptions = {}): Promise<PermissionsGraph> {
    await transport.require("permission.groupGraph", options);
    return transport.requestParsed(PermissionsGraph, `/api/permissions/graph/group/${id}`, {
      ...options,
    });
  }

  return { graph, databaseGraph, groupGraph };
}
