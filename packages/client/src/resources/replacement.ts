import { z } from "zod";

import {
  ReplacementCheck,
  type ReplacementModelWithTransformInput,
  ReplacementRun,
  ReplacementRunStarted,
  type ReplacementSourceInput,
} from "../domain/replacement";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

const ReplacementApiRunList = z.array(ReplacementRun);

const CancelRunResponse = z.object({ success: z.literal(true) });

export interface ReplacementRunListParams {
  "is-active"?: boolean | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function replacementResource(transport: Transport) {
  /**
   * Check whether every usage of a source entity could be rewritten to read a target entity
   * instead: the two must share a database, the target must not depend on the source, every source
   * column must exist on the target with a compatible type, and a table source must not be joined
   * implicitly or sandboxed. Admins only.
   */
  async function checkReplaceSource(
    params: ReplacementSourceInput,
    options: RequestOptions = {},
  ): Promise<ReplacementCheck> {
    await transport.require("replacement.checkReplaceSource", options);
    return transport.requestParsed(ReplacementCheck, "/api/ee/replacement/check-replace-source", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Rewrite every usage of a source entity to read a target entity, in the background. Runs the
   * same check as `checkReplaceSource` first and refuses with a 400 when it fails, and with a 409
   * while another replacement is running. Admins only.
   */
  async function replaceSource(
    params: ReplacementSourceInput,
    options: RequestOptions = {},
  ): Promise<ReplacementRunStarted> {
    await transport.require("replacement.replaceSource", options);
    return transport.requestParsed(ReplacementRunStarted, "/api/ee/replacement/replace-source", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Create a transform from a model's query, run it, and rewrite every usage of the model to read
   * the transform's output table, in the background; the model becomes a saved question. A failed
   * transform run leaves the model as it was; a failed rewrite keeps the transform and its table
   * as well, since other queries may already read them. Refuses with a 409 while another
   * replacement is running. Admins only.
   */
  async function replaceModelWithTransform(
    params: ReplacementModelWithTransformInput,
    options: RequestOptions = {},
  ): Promise<ReplacementRunStarted> {
    await transport.require("replacement.replaceModelWithTransform", options);
    return transport.requestParsed(
      ReplacementRunStarted,
      "/api/ee/replacement/replace-model-with-transform",
      { ...options, method: "POST", body: params },
    );
  }

  /**
   * List replacement runs, newest first. `is-active: true` keeps only the run in progress,
   * `false` only the ended ones. Admins only.
   */
  async function listRuns(
    params: ReplacementRunListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<ReplacementRun>> {
    await transport.require("replacement.listRuns", options);
    const data = await transport.requestParsed(ReplacementApiRunList, "/api/ee/replacement/runs", {
      ...options,
      query: { "is-active": params["is-active"] },
    });
    return { data, total: null };
  }

  /** Get one replacement run by id, with its status and progress. Admins only. */
  async function getRun(id: number, options: RequestOptions = {}): Promise<ReplacementRun> {
    await transport.require("replacement.getRun", options);
    return transport.requestParsed(ReplacementRun, `/api/ee/replacement/runs/${id}`, {
      ...options,
    });
  }

  /** Cancel the replacement in progress. Refuses with a 409 once the run has ended. Admins only. */
  async function cancelRun(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("replacement.cancelRun", options);
    await transport.requestParsed(CancelRunResponse, `/api/ee/replacement/runs/${id}/cancel`, {
      ...options,
      method: "POST",
    });
  }

  return {
    checkReplaceSource,
    replaceSource,
    replaceModelWithTransform,
    listRuns,
    getRun,
    cancelRun,
  };
}
