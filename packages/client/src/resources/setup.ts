import { type SetupInput, SetupResult } from "../domain/setup";
import type { RequestOptions, Transport } from "../http/transport";

export function setupResource(transport: Transport) {
  /**
   * Complete the initial setup wizard on a fresh instance, creating its first admin user and
   * applying the instance preferences. The setup token is single-use.
   */
  async function create(params: SetupInput, options: RequestOptions = {}): Promise<SetupResult> {
    return transport.requestParsed(SetupResult, "/api/setup", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { create };
}
