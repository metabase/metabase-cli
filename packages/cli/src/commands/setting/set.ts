import { z } from "zod";

import { SettingValue } from "@metabase/client/domain/setting";
import { settingValueView } from "../../output/views/setting";
import { formatScalar, renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseSettingKey } from "./key";

const SettingValueInput = z
  .unknown()
  .describe("Any JSON value; the setting's own type constraints are enforced server-side");

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
  inputSchema: SettingValueInput,
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
      SettingValueInput,
    );
    const client = await getClient();
    await client.setting.set(key, value);
    const item: SettingValue = { key, value };
    const message =
      value === null ? `Cleared "${key}".` : `Set "${key}" to ${formatScalar(value)}.`;
    renderSummary(item, settingValueView, message, ctx);
  },
});
