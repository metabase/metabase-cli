import { z } from "zod";

import { Workspace, type WorkspaceCreateInput } from "../domain/workspace";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

const WORKSPACE_MANAGER_PATH = "/api/ee/workspace-manager";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function workspaceManagerResource(transport: Transport) {
  const { explain } = explainer(transport, "workspaceManager");

  /** List all workspaces, each with its databases; admins only. `GET /api/ee/workspace-manager` answers a bare array. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Workspace>> {
    const data = await transport.requestParsed(z.array(Workspace), WORKSPACE_MANAGER_PATH, {
      ...options,
    });
    return { data, total: null };
  }

  /** Get a single workspace by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Workspace> {
    return transport.requestParsed(Workspace, `${WORKSPACE_MANAGER_PATH}/${id}`, { ...options });
  }

  /**
   * Create a workspace attached to the given databases, each of which must be eligible for
   * workspaces, and provision it. The server provisions every database before it answers, so the
   * caller sets a `timeoutMs` long enough for that. A provisioning failure whose cleanup also fails
   * answers the workspace with its databases `unprovisioned`, to be torn down by a delete.
   */
  async function create(
    params: WorkspaceCreateInput,
    options: RequestOptions = {},
  ): Promise<Workspace> {
    return transport.requestParsed(Workspace, WORKSPACE_MANAGER_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Delete a workspace, tearing down every database's warehouse isolation first. When any teardown
   * fails the workspace is kept with the failed databases, so the delete can be retried.
   */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`${WORKSPACE_MANAGER_PATH}/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * The workspace's developer-instance config, the YAML a Metabase boots from. It holds the
   * workspace's warehouse login. The server refuses with 409 while any of its databases is not
   * `provisioned`.
   */
  async function config(id: number, options: RequestOptions = {}): Promise<string> {
    const response = await transport.requestRaw(`${WORKSPACE_MANAGER_PATH}/${id}/config`, {
      ...options,
      expectContentType: "binary",
    });
    return response.text();
  }

  return {
    list: explain("list", list),
    get: explain("get", get),
    create: explain("create", create),
    delete: explain("delete", remove),
    config: explain("config", config),
  };
}
