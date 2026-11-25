import {
  MetadataSyncAnswer,
  MetadataSyncApplied,
  type MetadataSyncApplyInput,
  MetadataSyncRequest,
  type MetadataSyncRequestInput,
} from "../domain/metadata-sync";
import type { RequestOptions, Transport } from "../http/transport";

export function metadataSyncResource(transport: Transport) {
  /**
   * The request that asks the sender for the next page of the metadata of one of this server's
   * Databases, from the cursor `after`. The caller keeps the Database from syncing until the seed
   * ends, for example with `disable-auto-sync`. Superusers only.
   */
  async function request(
    params: MetadataSyncRequestInput,
    options: RequestOptions = {},
  ): Promise<MetadataSyncRequest> {
    return transport.requestParsed(MetadataSyncRequest, "/api/warehouse/metadata/request", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * The next page of the warehouse metadata of the Database a request names, as the sender holds
   * it, with the cursor of the page after it in `next`. Superusers only.
   */
  async function changes(
    params: MetadataSyncRequest,
    options: RequestOptions = {},
  ): Promise<MetadataSyncAnswer> {
    return transport.requestParsed(MetadataSyncAnswer, "/api/warehouse/metadata/changes", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Apply the sender's answer to a Database of this server that has no Tables, in one transaction,
   * so a refused answer writes nothing and can be sent again. `next` is the cursor of the next
   * request, absent after the last answer. Superusers only.
   */
  async function apply(
    params: MetadataSyncApplyInput,
    options: RequestOptions = {},
  ): Promise<MetadataSyncApplied> {
    return transport.requestParsed(MetadataSyncApplied, "/api/warehouse/metadata/apply", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { request, changes, apply };
}
