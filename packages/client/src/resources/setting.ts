import { z } from "zod";

import { Setting } from "../domain/setting";
import { ConfigError, errorMessage } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { fetchOptionalParsed } from "./optional-parsed";

// `GET /api/setting` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const SettingApiList = z.array(Setting);

const UNKNOWN_SETTING_PREFIX = "Unknown setting:";

// Metabase rejects an unknown key with a 400 that echoes it back as a Clojure keyword (":foo").
// Surface the caller's own key instead of the leading colon, and classify it as bad input.
function rethrowSettingError(error: unknown, key: string): never {
  if (errorMessage(error).startsWith(UNKNOWN_SETTING_PREFIX)) {
    throw new ConfigError(`unknown setting: ${key}`);
  }
  throw error;
}

export function settingResource(transport: Transport) {
  /** Get all settings and their values, with descriptions and environment-variable names. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Setting>> {
    const data = await transport.requestParsed(SettingApiList, "/api/setting", { ...options });
    return { data, total: null };
  }

  /**
   * Fetch a single setting's value by key. An unset setting answers 204 rather than 404, which
   * reaches the caller as `null`; older servers answer the value as bare text rather than JSON.
   */
  async function get(key: string, options: RequestOptions = {}): Promise<unknown> {
    const path = `/api/setting/${encodeURIComponent(key)}`;
    return fetchOptionalParsed(transport, path, z.unknown(), options).catch((error: unknown) =>
      rethrowSettingError(error, key),
    );
  }

  /** Set a single setting's value by key. The endpoint answers 204 with no body. */
  async function set(key: string, value: unknown, options: RequestOptions = {}): Promise<void> {
    await transport
      .requestRaw(`/api/setting/${encodeURIComponent(key)}`, {
        ...options,
        method: "PUT",
        body: { value },
        expectContentType: "binary",
      })
      .catch((error: unknown) => rethrowSettingError(error, key));
  }

  return { list, get, set };
}
