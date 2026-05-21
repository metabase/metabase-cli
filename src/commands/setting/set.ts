import { z } from "zod";

import { SettingValue, settingValueView } from "../../domain/setting";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseSettingKey } from "./key";

export default defineMetabaseCommand({
  meta: { name: "set", description: "Set a setting value (parsed strictly as JSON)" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    file: { type: "string", description: "Path to a file containing the JSON value" },
    key: { type: "positional", description: "Setting key", required: true },
    value: { type: "positional", description: "JSON-encoded value", required: false },
  },
  outputSchema: SettingValue,
  examples: [
    `mb setting set remote-sync-branch '"main"'`,
    `mb setting set anon-tracking-enabled true`,
    `echo '"main"' | mb setting set remote-sync-branch`,
    `mb setting set remote-sync-branch --file value.json`,
    `mb setting set remote-sync-branch null`,
  ],
  async run({ args, ctx, getClient }) {
    const key = parseSettingKey(args.key);
    const value = await readBody(
      { file: args.file, positional: args.value, source: `setting ${key} value` },
      z.unknown(),
    );
    const client = await getClient();
    await client.requestRaw(`/api/setting/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: { value },
      expectContentType: "binary",
    });
    const item: SettingValue = { key, value };
    renderItem(item, settingValueView, ctx);
  },
});
