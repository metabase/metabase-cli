import { z } from "zod";

import type { ResourceView } from "../../../output/view";
import { renderSummary } from "../../../output/render";
import { outputFlags, preflightFlag } from "../../flags";
import { parseId } from "../../parse-id";
import { defineMetabaseCommand } from "../../runtime";

const WorktreeDeleted = z.object({ id: z.number().int(), deleted: z.literal(true) });
type WorktreeDeleted = z.infer<typeof WorktreeDeleted>;

const worktreeDeletedView: ResourceView<WorktreeDeleted> = {
  compactPick: WorktreeDeleted,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "deleted", label: "Deleted" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "delete",
    description: "Delete a worktree and every piece of content it checked out",
  },
  requires: ["gitSync.deleteWorktree"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Worktree id", required: true },
  },
  outputSchema: WorktreeDeleted,
  examples: ["mb git-sync worktree delete 3", "mb git-sync worktree delete 3 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const mb = await getClient();
    await mb.gitSync.deleteWorktree(id);
    const result: WorktreeDeleted = { id, deleted: true };
    renderSummary(result, worktreeDeletedView, `Deleted worktree ${id}.`, ctx);
  },
});
