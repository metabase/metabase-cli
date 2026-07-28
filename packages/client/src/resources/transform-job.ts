import { z } from "zod";

import { Transform } from "../domain/transform";
import {
  TransformJob,
  TransformJobActiveResult,
  type TransformJobCreateInput,
  TransformJobRunResult,
  type TransformJobUpdateInput,
} from "../domain/transform-job";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/transform-job` answers a bare array rather than a `{ data, total }` envelope, so the
// count a caller reads off `ListResult` is the array's own length and the server reports none.
const TransformJobApiList = z.array(TransformJob);

// `GET /api/transform-job/{id}/transforms` answers a bare array of transforms. `resources/transform`
// declares the same shape for its own listings; the two files may not reach into each other, and a
// module both could import would be the bucket module the layout rules forbid.
const TransformApiList = z.array(Transform);

export interface TransformJobRunParams {
  /** Re-run the whole plan, including dependencies that are already fresh. */
  run_all?: boolean | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformJobResource(transport: Transport) {
  /** List every transform job the caller can see. */
  async function list(options: RequestOptions = {}): Promise<ListResult<TransformJob>> {
    const data = await transport.requestParsed(TransformJobApiList, "/api/transform-job", {
      ...options,
    });
    return { data, total: null };
  }

  /** Get one transform job by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformJob> {
    return transport.requestParsed(TransformJob, `/api/transform-job/${id}`, { ...options });
  }

  /** Create a transform job — a schedule plus the tags it runs — from a full body. */
  async function create(
    params: TransformJobCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformJob> {
    return transport.requestParsed(TransformJob, "/api/transform-job", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a transform job by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TransformJobUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformJob> {
    return transport.requestParsed(TransformJob, `/api/transform-job/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a transform job by id, leaving the transforms it ran untouched. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/transform-job/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Start a run of a transform job by id. The job runs every transform carrying one of its tags,
   * plus those transforms' dependencies; `run_all` re-runs dependencies that are already fresh.
   */
  async function run(
    id: number,
    params: TransformJobRunParams = {},
    options: RequestOptions = {},
  ): Promise<TransformJobRunResult> {
    return transport.requestParsed(TransformJobRunResult, `/api/transform-job/${id}/run`, {
      ...options,
      method: "POST",
      body: { run_all: params.run_all },
    });
  }

  /** List the transforms a job would execute, resolved from the job's tags. */
  async function transforms(
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<Transform>> {
    const data = await transport.requestParsed(
      TransformApiList,
      `/api/transform-job/${id}/transforms`,
      { ...options },
    );
    return { data, total: null };
  }

  /**
   * Flip the active flag on every transform job at once. Inactive jobs do not run on schedule;
   * manual runs ignore the flag. The path carries no id and is a different endpoint from `update`.
   */
  async function setActive(
    active: boolean,
    options: RequestOptions = {},
  ): Promise<TransformJobActiveResult> {
    return transport.requestParsed(TransformJobActiveResult, "/api/transform-job/active", {
      ...options,
      method: "PUT",
      body: { active },
    });
  }

  return { list, get, create, update, delete: remove, run, transforms, setActive };
}
