import { TransformTagCompact } from "@metabase/client/domain/transform-tag";
import { transformTagView } from "../../output/views/transform-tag";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const TransformTagListEnvelope = listEnvelopeSchema(TransformTagCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform tags" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: TransformTagListEnvelope,
  examples: [
    "mb transform-tag list",
    "mb transform-tag list --json",
    "mb transform-tag list --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const client = await getClient();
    const scope = await getWorktree();
    const { data } = await client.transformTag.list(scopeQuery(scope));
    renderList(windowList(data, ctx.range), transformTagView, ctx);
  },
});
