import { SyncDirtyItemCompact } from "@metabase/client/domain/git-sync";

import { syncDirtyItemView } from "../../output/views/git-sync";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const SyncDirtyListEnvelope = listEnvelopeSchema(SyncDirtyItemCompact);

export default defineMetabaseCommand({
  meta: { name: "dirty", description: "List objects with unsynced local changes" },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: SyncDirtyListEnvelope,
  examples: [
    "mb git-sync dirty",
    "mb git-sync dirty --json",
    "mb git-sync dirty --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const { data } = await mb.gitSync.dirty(scopeQuery(scope));
    renderList(windowList(data, ctx.range), syncDirtyItemView, ctx);
  },
});
