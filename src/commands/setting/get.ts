import { z } from "zod";

import type { Client } from "../../core/http/client";
import { SettingValue, settingValueView } from "../../domain/setting";
import { formatScalar, renderSummary } from "../../output/render";
import { parseJsonOrPlain } from "../../runtime/json";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseSettingKey, rethrowSettingError } from "./key";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a setting value by key" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    key: { type: "positional", description: "Setting key", required: true },
  },
  outputSchema: SettingValue,
  examples: ["mb setting get remote-sync-branch", "mb setting get site-name --json"],
  async run({ args, ctx, getClient }) {
    const key = parseSettingKey(args.key);
    const client = await getClient();
    const value = await fetchSettingValue(client, key).catch((error: unknown) =>
      rethrowSettingError(error, key),
    );
    const item: SettingValue = { key, value };
    renderSummary(item, settingValueView, formatScalar(value), ctx);
  },
});

async function fetchSettingValue(client: Client, key: string): Promise<unknown> {
  const response = await client.requestRaw(`/api/setting/${encodeURIComponent(key)}`, {
    method: "GET",
    expectContentType: "binary",
  });
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  return parseJsonOrPlain(text, response.headers.get("content-type"), z.unknown(), {
    source: response.url,
  });
}
