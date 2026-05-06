import { z } from "zod";

import { Setting, SettingCompact, settingView } from "../../domain/setting";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const SettingApiList = z.array(Setting);

export const SettingListEnvelope = listEnvelopeSchema(SettingCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List all settings (admin)" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SettingListEnvelope,
  examples: ["metabase setting list", "metabase setting list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const settings = await client.requestParsed(SettingApiList, "/api/setting");
    renderList(wrapList(settings), settingView, ctx);
  },
});
