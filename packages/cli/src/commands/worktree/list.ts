import { WorktreeCompact } from "@metabase/client/domain/worktree";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { worktreeView } from "../../output/views/worktree";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const WorktreeListEnvelope = listEnvelopeSchema(WorktreeCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List the git-sync worktrees on this instance" },
  capabilities: { minVersion: 64, tokenFeature: "remote_sync" },
  worktree: "any",
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: WorktreeListEnvelope,
  examples: ["mb worktree list", "mb worktree list --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const { data } = await mb.gitSync.worktrees();
    renderList(windowList(data, ctx.range), worktreeView, ctx);
  },
});
