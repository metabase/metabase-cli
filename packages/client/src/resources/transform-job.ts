import { z } from "zod";

import { type Transform, transformRowSchema } from "../domain/transform";
import {
  type TransformJob,
  TransformJobActiveResult,
  type TransformJobCreateInput,
  type TransformJobRunResult,
  transformJobRunResultSchema,
  transformJobSchema,
  type TransformJobUpdateInput,
} from "../domain/transform-job";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

export interface TransformJobRunParams {
  /** Re-run the whole plan, including dependencies that are already fresh. */
  run_all?: boolean | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformJobResource(transport: Transport) {
  /** List every transform job the caller can see. */
  async function list(options: RequestOptions = {}): Promise<ListResult<TransformJob>> {
    await transport.require("transformJob.list", options);
    const { features } = await transport.server(options);
    // A bare array rather than a `{ data, total }` envelope, so the server reports no count.
    const data = await transport.requestParsed(
      z.array(transformJobSchema(features)),
      "/api/transform-job",
      { ...options },
    );
    return { data, total: null };
  }

  /** Get one transform job by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformJob> {
    await transport.require("transformJob.get", options);
    const { features } = await transport.server(options);
    return transport.requestParsed(transformJobSchema(features), `/api/transform-job/${id}`, {
      ...options,
    });
  }

  /** Create a transform job — a schedule plus the tags it runs — from a full body. */
  async function create(
    params: TransformJobCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformJob> {
    await transport.require("transformJob.create", options);
    const { features } = await transport.server(options);
    return transport.requestParsed(transformJobSchema(features), "/api/transform-job", {
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
    await transport.require("transformJob.update", options);
    const { features } = await transport.server(options);
    return transport.requestParsed(transformJobSchema(features), `/api/transform-job/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a transform job by id, leaving the transforms it ran untouched. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transformJob.delete", options);
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
    await transport.require("transformJob.run", options);
    const { features } = await transport.server(options);
    return transport.requestParsed(
      transformJobRunResultSchema(features),
      `/api/transform-job/${id}/run`,
      { ...options, method: "POST", body: { run_all: params.run_all } },
    );
  }

  /** List the transforms a job would execute, resolved from the job's tags. */
  async function transforms(
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<Transform>> {
    await transport.require("transformJob.transforms", options);
    const { features } = await transport.server(options);
    const data = await transport.requestParsed(
      z.array(transformRowSchema(features)),
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
    await transport.require("transformJob.setActive", options);
    return transport.requestParsed(TransformJobActiveResult, "/api/transform-job/active", {
      ...options,
      method: "PUT",
      body: { active },
    });
  }

  return { list, get, create, update, delete: remove, run, transforms, setActive };
}
