import { TransformCompact } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const TransformListEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transforms" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: TransformListEnvelope,
  examples: [
    "mb transform list",
    "mb transform list --json",
    "mb transform list --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const client = await getClient();
    const scope = await getWorktree();
    const { data } = await client.transform.list(scopeQuery(scope));
    renderList(windowList(data, ctx.range), transformView, ctx);
  },
});
