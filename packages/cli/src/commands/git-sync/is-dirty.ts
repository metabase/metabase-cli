import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const IsDirtyResult = z.object({
  is_dirty: z.boolean(),
});
type IsDirtyResult = z.infer<typeof IsDirtyResult>;

const isDirtyView: ResourceView<IsDirtyResult> = {
  compactPick: IsDirtyResult,
  tableColumns: [{ key: "is_dirty", label: "Dirty" }],
};

export default defineMetabaseCommand({
  meta: {
    name: "is-dirty",
    description: "Check whether Metabase has unsynced local changes",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: IsDirtyResult,
  examples: [
    "mb git-sync is-dirty",
    "mb git-sync is-dirty --json",
    "mb git-sync is-dirty --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const result: IsDirtyResult = { is_dirty: await mb.gitSync.isDirty(scopeQuery(scope)) };
    renderSummary(result, isDirtyView, result.is_dirty ? "dirty" : "clean", ctx);
  },
});
