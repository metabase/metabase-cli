import { z } from "zod";

import {
  PermissionGroup,
  type PermissionGroupCreateInput,
  type PermissionGroupUpdateInput,
  SavedPermissionGroup,
} from "../domain/permission";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function groupResource(transport: Transport) {
  /**
   * List the permission groups, each with its member count. Needs an admin, the settings
   * application permission, or a group manager, who sees only the groups they manage.
   * `GET /api/permissions/group` answers a bare array.
   */
  async function list(options: RequestOptions = {}): Promise<ListResult<PermissionGroup>> {
    const data = await transport.requestParsed(z.array(PermissionGroup), "/api/permissions/group", {
      ...options,
    });
    return { data, total: null };
  }

  /**
   * Create a permission group with no members; on each database it starts with data permissions
   * based on the All Users group's. Admins only.
   */
  async function create(
    params: PermissionGroupCreateInput,
    options: RequestOptions = {},
  ): Promise<SavedPermissionGroup> {
    return transport.requestParsed(SavedPermissionGroup, "/api/permissions/group", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Rename a permission group by id. Needs an admin or, with advanced permissions, a manager of the
   * group; a built-in group, one with a `magic_group_type`, cannot be renamed.
   */
  async function update(
    id: number,
    params: PermissionGroupUpdateInput,
    options: RequestOptions = {},
  ): Promise<SavedPermissionGroup> {
    return transport.requestParsed(SavedPermissionGroup, `/api/permissions/group/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Delete a permission group by id, with its memberships and permissions. Needs an admin or, with
   * advanced permissions, a manager of the group; a built-in group, one with a `magic_group_type`,
   * cannot be deleted. Through Metabase 65 the server does not check that the id names a group, so
   * deleting a missing one succeeds; from Metabase 66 it answers 404.
   */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/permissions/group/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { list, create, update, delete: remove };
}
