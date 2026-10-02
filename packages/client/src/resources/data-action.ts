import { z } from "zod";

import {
  type DataAction,
  type DataActionCreateInput,
  type DataActionExecuteInput,
  DataActionExecuteResult,
  dataActionSchema,
  type DataActionUpdateInput,
} from "../domain/data-action";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function dataActionResource(transport: Transport) {
  async function readSchema(options: RequestOptions): Promise<z.ZodType<DataAction>> {
    const { features } = await transport.server(options);
    return dataActionSchema(features);
  }

  /** List the unarchived data actions the caller can see. `GET /api/action` answers a bare array. */
  async function list(options: RequestOptions = {}): Promise<ListResult<DataAction>> {
    await transport.require("dataAction.list", options);
    const schema = await readSchema(options);
    const data = await transport.requestParsed(z.array(schema), "/api/action", { ...options });
    return { data, total: null };
  }

  /** Get one unarchived data action by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<DataAction> {
    await transport.require("dataAction.get", options);
    const schema = await readSchema(options);
    return transport.requestParsed(schema, `/api/action/${id}`, { ...options });
  }

  /** Create a data action — a parameterized native query that writes to a database — in a collection. */
  async function create(
    params: DataActionCreateInput,
    options: RequestOptions = {},
  ): Promise<DataAction> {
    await transport.require("dataAction.create", options);
    const schema = await readSchema(options);
    return transport.requestParsed(schema, "/api/action", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a data action by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: DataActionUpdateInput,
    options: RequestOptions = {},
  ): Promise<DataAction> {
    await transport.require("dataAction.update", options);
    const schema = await readSchema(options);
    return transport.requestParsed(schema, `/api/action/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a data action by id. Metabase models this as an update, not its own endpoint. */
  async function archive(id: number, options: RequestOptions = {}): Promise<DataAction> {
    await transport.require("dataAction.archive", options);
    return update(id, { archived: true }, options);
  }

  /** Delete a data action by id, removing it and the dashboard buttons that run it. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("dataAction.delete", options);
    await transport.requestRaw(`/api/action/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /** Execute a data action by id with parameter values keyed by parameter id. */
  async function execute(
    id: number,
    params: DataActionExecuteInput,
    options: RequestOptions = {},
  ): Promise<DataActionExecuteResult> {
    await transport.require("dataAction.execute", options);
    return transport.requestParsed(DataActionExecuteResult, `/api/action/${id}/execute`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { list, get, create, update, archive, delete: remove, execute };
}
