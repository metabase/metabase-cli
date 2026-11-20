import { SettingCompact } from "@metabase/client/domain/setting";
import { settingView } from "../../output/views/setting";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SettingListEnvelope = listEnvelopeSchema(SettingCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List all settings (admin)" },
  details:
    "The full rows, with each setting's `description` and `default`, can go over the default output cap; `--max-bytes 0` lifts it.",
  requires: ["setting.list"],
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SettingListEnvelope,
  examples: [
    "mb setting list",
    "mb setting list --json",
    "mb setting list --full --json --max-bytes 0",
  ],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.setting.list();
    renderList(windowList(data, ctx.range, total), settingView, ctx);
  },
});
