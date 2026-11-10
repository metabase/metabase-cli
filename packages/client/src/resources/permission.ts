import { z } from "zod";

import { PermissionGroup, PermissionsGraph } from "../domain/permission";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

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
   * List the permission groups, each with its member count. Needs an admin, the settings
   * application permission, or a group manager, who sees only the groups they manage.
   * `GET /api/permissions/group` answers a bare array.
   */
  async function groups(options: RequestOptions = {}): Promise<ListResult<PermissionGroup>> {
    const data = await transport.requestParsed(z.array(PermissionGroup), "/api/permissions/group", {
      ...options,
    });
    return { data, total: null };
  }

  return { graph, databaseGraph, groupGraph, groups };
}
