import { CardQueryResult } from "../domain/card";
import {
  MetricBreakoutValues,
  type MetricDefinition,
  MetricDimensionListing,
} from "../domain/metric";
import type { RequestOptions, Transport } from "../http/transport";

export interface MetricDimensionListParams {
  query?: string | undefined;
  "with-addable"?: boolean | undefined;
  "include-orphaned"?: boolean | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function metricResource(transport: Transport) {
  /**
   * Run a metric definition and return the query result envelope: one metric or measure, or an
   * arithmetic expression over several, each leaf filtered and projected on its own `lib/uuid`.
   */
  async function query(
    definition: MetricDefinition,
    options: RequestOptions = {},
  ): Promise<CardQueryResult> {
    await transport.require("metric.query", options);
    return transport.requestParsed(CardQueryResult, "/api/metric/dataset", {
      ...options,
      method: "POST",
      body: { definition },
    });
  }

  /**
   * Fetch the distinct values of a definition's breakout dimension, with that column's metadata.
   * Takes the same definition `query` does.
   */
  async function breakoutValues(
    definition: MetricDefinition,
    options: RequestOptions = {},
  ): Promise<MetricBreakoutValues> {
    await transport.require("metric.breakoutValues", options);
    return transport.requestParsed(MetricBreakoutValues, "/api/metric/breakout-values", {
      ...options,
      method: "POST",
      body: { definition },
    });
  }

  /**
   * List a metric's curated dimensions and, under `with-addable`, the columns still available to
   * add, grouped by source table. `query` filters both by a name substring.
   */
  async function dimensions(
    id: number,
    params: MetricDimensionListParams = {},
    options: RequestOptions = {},
  ): Promise<MetricDimensionListing> {
    await transport.require("metric.dimensions", options);
    return transport.requestParsed(MetricDimensionListing, `/api/metric/${id}/dimension`, {
      ...options,
      query: {
        query: params.query,
        "with-addable": params["with-addable"],
        "include-orphaned": params["include-orphaned"],
      },
    });
  }

  return { query, breakoutValues, dimensions };
}
