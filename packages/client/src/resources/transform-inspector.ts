import { CardQueryResult } from "../domain/card";
import {
  type LensParams,
  TransformInspection,
  TransformLens,
  type TransformLensQueryInput,
} from "../domain/transform-inspector";
import type { RequestOptions, Transport } from "../http/transport";

function lensPath(id: number, lensId: string): string {
  return `/api/ee/transforms/${id}/inspect/${encodeURIComponent(lensId)}`;
}

export function transformInspectorResource(transport: Transport) {
  /**
   * Discover what the inspector can show for a transform: its source and target tables with field
   * statistics, the fields its query touches, and the lenses available on it.
   */
  async function discover(id: number, options: RequestOptions = {}): Promise<TransformInspection> {
    await transport.require("transformInspector.discover", options);
    return transport.requestParsed(TransformInspection, `/api/ee/transforms/${id}/inspect`, {
      ...options,
    });
  }

  /**
   * Open one lens on a transform: its sections, the cards with the queries that fill them, and
   * the alert and drill-lens triggers to evaluate against the card results. A drill lens takes
   * the `params` its trigger emitted.
   */
  async function lens(
    id: number,
    lensId: string,
    params: LensParams = {},
    options: RequestOptions = {},
  ): Promise<TransformLens> {
    await transport.require("transformInspector.lens", options);
    return transport.requestParsed(TransformLens, lensPath(id, lensId), {
      ...options,
      query: { join_step: params.join_step },
    });
  }

  /**
   * Run a lens card's query in the context of the lens, so the execution is attributed to the
   * inspector. The body is the card's `dataset_query`, and the same `lens_params` the lens was
   * opened with.
   */
  async function query(
    id: number,
    lensId: string,
    params: TransformLensQueryInput,
    options: RequestOptions = {},
  ): Promise<CardQueryResult> {
    await transport.require("transformInspector.query", options);
    return transport.requestParsed(CardQueryResult, `${lensPath(id, lensId)}/query`, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { discover, lens, query };
}
