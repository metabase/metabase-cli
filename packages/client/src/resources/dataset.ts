import { CardQueryResult } from "../domain/card";
import type { RequestOptions, Transport } from "../http/transport";

export function datasetResource(transport: Transport) {
  /**
   * Run an ad-hoc query and return its result envelope. The body is a whole query — MBQL 5, legacy
   * MBQL, or native — rather than a reference to a saved one, so nothing here is a card.
   */
  async function query(body: unknown, options: RequestOptions = {}): Promise<CardQueryResult> {
    return transport.requestParsed(CardQueryResult, "/api/dataset", {
      ...options,
      method: "POST",
      body,
    });
  }

  return { query };
}
