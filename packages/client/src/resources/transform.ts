import { z } from "zod";

import {
  isTransformRunFailed,
  isTransformRunTerminal,
  type Transform,
  type TransformCreateInput,
  transformDetailSchema,
  TransformRun,
  type TransformRunResult,
  transformRowSchema,
  type TransformUpdateInput,
} from "../domain/transform";
import { TimeoutError } from "../errors";
import type { RequestOptions, Transport, TransportRequestOptions } from "../http/transport";
import type { ListResult } from "../list";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";
import { type PollOptions, pollUntil } from "../poll";
import type { Features } from "../version/features";

// `GET /api/transform` and `GET /api/transform/{id}/dependencies` both answer a bare array rather
// than a `{ data, total }` envelope, so the count a caller reads off `ListResult` is the array's
// own length and the server reports none.
function transformListSchema(features: Features) {
  return z.array(transformRowSchema(features));
}

// The run endpoint answers as soon as the run is queued, and says nothing about how it went.
const TransformRunKickoff = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
});

export interface TransformRunParams {
  /** Poll the run to a terminal status. Without it the call returns once the run is queued. */
  wait?: PollOptions | undefined;
  /**
   * After a successful run, additionally poll until the run's output table is registered and
   * report its id. Implies waiting for the run itself.
   */
  syncTarget?: boolean | undefined;
}

export interface TransformRunPageParams {
  "transform-ids"?: number | undefined;
}

// The walk's own settings, minus the query the method builds from `TransformRunPageParams`.
export type TransformRunPageOptions = Omit<PaginateOptions, "query">;

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformResource(transport: Transport) {
  // The wire shape is the server's generation's to decide, so every read goes through the profile.
  async function requestTransformList(
    path: string,
    opts: TransportRequestOptions,
  ): Promise<ListResult<Transform>> {
    const { features } = await transport.server();
    const data = await transport.requestParsed(transformListSchema(features), path, opts);
    return { data, total: null };
  }

  async function requestTransform(path: string, opts: TransportRequestOptions): Promise<Transform> {
    const { features } = await transport.server();
    return transport.requestParsed(transformRowSchema(features), path, opts);
  }

  /** List every transform the caller can see. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Transform>> {
    await transport.require("transform.list");
    return requestTransformList("/api/transform", { ...options });
  }

  /** Get one transform by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Transform> {
    await transport.require("transform.get");
    const { features } = await transport.server();
    return transport.requestParsed(transformDetailSchema(features), `/api/transform/${id}`, {
      ...options,
    });
  }

  /** Create a transform — a query plus the warehouse table it writes — from a full body. */
  async function create(
    params: TransformCreateInput,
    options: RequestOptions = {},
  ): Promise<Transform> {
    await transport.require("transform.create");
    return requestTransform("/api/transform", { ...options, method: "POST", body: params });
  }

  /** Update a transform by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TransformUpdateInput,
    options: RequestOptions = {},
  ): Promise<Transform> {
    await transport.require("transform.update");
    return requestTransform(`/api/transform/${id}`, { ...options, method: "PUT", body: params });
  }

  /** Delete a transform by id, leaving any table it already materialized in place. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transform.delete");
    await transport.requestRaw(`/api/transform/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /** Drop a transform's materialized output table, keeping the transform definition. */
  async function deleteTable(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transform.deleteTable");
    await transport.requestRaw(`/api/transform/${id}/table`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /** List the upstream transforms a transform depends on. */
  async function dependencies(
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<Transform>> {
    await transport.require("transform.dependencies");
    return requestTransformList(`/api/transform/${id}/dependencies`, { ...options });
  }

  /** Request cancellation of a transform's current run. */
  async function cancel(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transform.cancel");
    await transport.requestRaw(`/api/transform/${id}/cancel`, {
      ...options,
      method: "POST",
      expectContentType: "binary",
    });
  }

  /** Get one transform run by run id — not by the id of the transform that produced it. */
  async function getRun(runId: number, options: RequestOptions = {}): Promise<TransformRun> {
    await transport.require("transform.getRun");
    return transport.requestParsed(TransformRun, `/api/transform/run/${runId}`, { ...options });
  }

  /** Walk the run history, newest first, optionally narrowed to a single transform. */
  async function* runPages(
    params: TransformRunPageParams = {},
    options: TransformRunPageOptions = {},
  ): AsyncIterable<Page<TransformRun>> {
    await transport.require("transform.runPages");
    yield* paginatePages(transport, "/api/transform/run", TransformRun, {
      query: { "transform-ids": params["transform-ids"] },
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  /**
   * Start a run of a transform by id. The server queues the run and answers at once; `wait` polls
   * it to a terminal status, and `syncTarget` follows that with the output table's registration.
   * A server that answers no run id started nothing, and there is then nothing to poll.
   */
  async function run(
    id: number,
    params: TransformRunParams = {},
    options: RequestOptions = {},
  ): Promise<TransformRunResult> {
    await transport.require("transform.run");
    const kickoff = await transport.requestParsed(TransformRunKickoff, `/api/transform/${id}/run`, {
      ...options,
      method: "POST",
    });
    const schedule = params.syncTarget === true ? (params.wait ?? {}) : params.wait;
    if (schedule === undefined || kickoff.run_id === null) {
      return { message: kickoff.message, run_id: kickoff.run_id, final: null };
    }

    const runId = kickoff.run_id;
    const final = await pollUntil(
      async (signal) => getRun(runId, { ...options, signal }),
      (candidate) => isTransformRunTerminal(candidate.status),
      schedule,
    );
    if (params.syncTarget !== true) {
      return { message: kickoff.message, run_id: runId, final };
    }

    const failed = isTransformRunFailed(final.status);
    const targetTableId = failed ? null : await awaitTargetTableId(id, schedule, options);
    return { message: kickoff.message, run_id: runId, final, target_table_id: targetTableId };
  }

  // A successful run registers its own output table — Metabase syncs the single materialized table
  // as part of run completion, so no explicit database sync is needed. A poll timeout answers null
  // rather than throwing, because the table may still be syncing and the run itself already
  // succeeded.
  async function awaitTargetTableId(
    id: number,
    wait: PollOptions,
    options: RequestOptions,
  ): Promise<number | null> {
    try {
      const linked = await pollUntil(
        async (signal) => get(id, { ...options, signal }),
        (transform) => transform.target_table_id !== null,
        wait,
      );
      return linked.target_table_id;
    } catch (error) {
      if (error instanceof TimeoutError) {
        return null;
      }
      throw error;
    }
  }

  return {
    list,
    get,
    create,
    update,
    delete: remove,
    deleteTable,
    dependencies,
    cancel,
    getRun,
    runPages,
    run,
  };
}
