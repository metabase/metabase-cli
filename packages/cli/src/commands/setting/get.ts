import { SettingValue } from "@metabase/client/domain/setting";

import { formatScalar, renderSummary } from "../../output/render";
import { settingValueView } from "../../output/views/setting";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSettingKey } from "./key";

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
    const value = await client.setting.get(key);
    const item: SettingValue = { key, value };
    renderSummary(item, settingValueView, formatScalar(value), ctx);
  },
});
