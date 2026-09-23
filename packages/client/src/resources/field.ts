import { FieldValues } from "../domain/field";
import type { RequestOptions, Transport } from "../http/transport";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function fieldResource(transport: Transport) {
  /** Get the cached distinct values Metabase holds for a field. */
  async function values(id: number, options: RequestOptions = {}): Promise<FieldValues> {
    await transport.require("field.values", options);
    return transport.requestParsed(FieldValues, `/api/field/${id}/values`, { ...options });
  }

  return { values };
}
