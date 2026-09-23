import { SyncDirtyItemCompact } from "@metabase/client/domain/git-sync";

import { syncDirtyItemView } from "../../output/views/git-sync";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SyncDirtyListEnvelope = listEnvelopeSchema(SyncDirtyItemCompact);

export default defineMetabaseCommand({
  meta: { name: "dirty", description: "List objects with unsynced local changes" },
  requires: ["gitSync.dirty"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: SyncDirtyListEnvelope,
  examples: ["mb git-sync dirty", "mb git-sync dirty --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const { data } = await mb.gitSync.dirty();
    renderList(windowList(data, ctx.range), syncDirtyItemView, ctx);
  },
});
