import type { ZodType } from "zod";

import type { RequestOptions, Transport } from "../http/transport";
import { parseJsonOrPlain } from "../json";

const NO_CONTENT_STATUS = 204;

// Endpoints that answer 204 for "the value is unset" rather than 404, and answer the value itself
// as either JSON or bare text depending on the server version. `null` is the unset value, not an
// error.
export async function fetchOptionalParsed<T>(
  client: Transport,
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T | null> {
  const response = await client.requestRaw(path, {
    ...options,
    method: "GET",
    expectContentType: "binary",
  });
  if (response.status === NO_CONTENT_STATUS) {
    return null;
  }
  const text = await response.text();
  return parseJsonOrPlain(text, response.headers.get("content-type"), schema, {
    source: response.url,
  });
}
