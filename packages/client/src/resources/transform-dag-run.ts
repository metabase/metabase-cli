import { z } from "zod";

import { TransformMemberRun } from "../domain/transform-dag-run";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// A bare array rather than a `{ data, total }` envelope, so the server reports no count.
const TransformMemberRunList = z.array(TransformMemberRun);

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformDagRunResource(transport: Transport) {
  /**
   * List the transform runs a DAG run coordinated so far. A member run is inserted when its
   * transform starts, so the list grows while the DAG run is in progress.
   */
  async function transformRuns(
    runId: number,
    options: RequestOptions = {},
  ): Promise<ListResult<TransformMemberRun>> {
    await transport.require("transformDagRun.transformRuns", options);
    const data = await transport.requestParsed(
      TransformMemberRunList,
      `/api/transform-dag-run/${runId}/transform-runs`,
      { ...options },
    );
    return { data, total: null };
  }

  /** Cancel an in-progress DAG run and request cancellation of its still-running transforms. */
  async function cancel(runId: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transformDagRun.cancel", options);
    await transport.requestRaw(`/api/transform-dag-run/${runId}/cancel`, {
      ...options,
      method: "POST",
      expectContentType: "binary",
    });
  }

  return { transformRuns, cancel };
}
