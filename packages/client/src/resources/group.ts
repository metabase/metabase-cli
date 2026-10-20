import { z } from "zod";

import { Group, type GroupCreateInput, type GroupUpdateInput } from "../domain/group";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function groupResource(transport: Transport) {
  /** List every permission group, including the built-in All Users and Administrators. Admins only. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Group>> {
    const data = await transport.requestParsed(z.array(Group), "/api/permissions/group", {
      ...options,
    });
    return { data, total: null };
  }

  /** Create a permission group with no members. Admins only. */
  async function create(params: GroupCreateInput, options: RequestOptions = {}): Promise<Group> {
    return transport.requestParsed(Group, "/api/permissions/group", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Rename a permission group by id. Admins only; the built-in groups cannot be renamed. */
  async function update(
    id: number,
    params: GroupUpdateInput,
    options: RequestOptions = {},
  ): Promise<Group> {
    return transport.requestParsed(Group, `/api/permissions/group/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Delete a permission group by id, with its memberships and permissions. Admins only; the
   * built-in groups cannot be deleted.
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
