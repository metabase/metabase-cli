import { WorktreeCompact } from "@metabase/client/domain/worktree";

import { renderList } from "../../../output/render";
import { listEnvelopeSchema } from "../../../output/types";
import { worktreeView } from "../../../output/views/worktree";
import { windowList } from "../../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../../flags";
import { defineMetabaseCommand } from "../../runtime";

const WorktreeListEnvelope = listEnvelopeSchema(WorktreeCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List remote-sync worktrees" },
  requires: ["gitSync.worktrees"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: WorktreeListEnvelope,
  examples: ["mb git-sync worktree list", "mb git-sync worktree list --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const { data, total } = await mb.gitSync.worktrees();
    renderList(windowList(data, ctx.range, total), worktreeView, ctx);
  },
});
