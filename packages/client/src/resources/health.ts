import { Health } from "../domain/health";
import { HttpError, SERVICE_UNAVAILABLE_STATUS } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import { parseJsonResult } from "../json";

export function healthResource(transport: Transport) {
  /**
   * Check whether the server is up: `ok` once it has booted and reaches its app database, else
   * `initializing` with its `progress`, or why the app database is out of reach. Needs no
   * credential. Answers without retrying unless `retries` is set.
   */
  async function get(options: RequestOptions = {}): Promise<Health> {
    try {
      return await transport.requestParsed(Health, "/api/health", {
        ...options,
        // The transport retries a 503 on a GET, which would stall a caller polling a booting server.
        retries: options.retries ?? 0,
      });
    } catch (error) {
      // A booting or unhealthy server answers its health at 503, which is the answer, not a failure.
      if (!(error instanceof HttpError) || error.status !== SERVICE_UNAVAILABLE_STATUS) {
        throw error;
      }
      const { body } = error.developerDetail;
      if (body === null) {
        throw error;
      }
      const health = parseJsonResult(body, Health);
      if (!health.ok) {
        throw error;
      }
      return health.value;
    }
  }

  return { get };
}
