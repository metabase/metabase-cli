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
import { explainer, type ParameterRequirement } from "../version/refusal";

// A server whose data actions have no collection rejects `collection_id` with a 400 naming it.
function collectionFeatures(params: DataActionUpdateInput): ParameterRequirement[] {
  return params.collection_id === undefined
    ? []
    : [{ feature: "dataActionCollections", fields: ["collection_id"] }];
}

export interface DataActionListParams {
  /** List archived data actions instead of unarchived ones. */
  archived?: boolean | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function dataActionResource(transport: Transport) {
  const { explain } = explainer(transport, "dataAction");

  async function readSchema(options: RequestOptions): Promise<z.ZodType<DataAction>> {
    const { features } = await transport.server(options);
    return dataActionSchema(features);
  }

  /**
   * List the actions the caller can see, unarchived unless `archived` is set. `GET /api/action`
   * answers a bare array. A server without archived listing ignores `archived` and answers the
   * unarchived actions, so it is refused before the wire there.
   */
  async function list(
    params: DataActionListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DataAction>> {
    await transport.requireFeatures(params.archived ? ["dataActionArchivedList"] : [], options);
    const schema = await readSchema(options);
    const data = await transport.requestParsed(z.array(schema), "/api/action", {
      ...options,
      query: { archived: params.archived },
    });
    return { data, total: null };
  }

  /** Get one unarchived data action by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<DataAction> {
    const schema = await readSchema(options);
    return transport.requestParsed(schema, `/api/action/${id}`, { ...options });
  }

  /**
   * Create a data action — a parameterized native query that writes to a database — in a data
   * actions collection, or in their root without a `collection_id`.
   */
  async function create(
    params: DataActionCreateInput,
    options: RequestOptions = {},
  ): Promise<DataAction> {
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
    const schema = await readSchema(options);
    return transport.requestParsed(schema, `/api/action/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a data action by id. Metabase models this as an update, not its own endpoint. */
  async function archive(id: number, options: RequestOptions = {}): Promise<DataAction> {
    return update(id, { archived: true }, options);
  }

  /** Delete a data action by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
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
    return transport.requestParsed(DataActionExecuteResult, `/api/action/${id}/execute`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return {
    list,
    get,
    create: explain("create", create),
    update: explain("update", update, (_id, params) => collectionFeatures(params)),
    archive,
    delete: remove,
    execute,
  };
}
