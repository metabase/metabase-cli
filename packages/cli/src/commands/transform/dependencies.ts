import { TransformCompact } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const TransformDependenciesEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "dependencies", description: "List the transforms a transform depends on" },
  details:
    "Returns the upstream transforms in this transform's dependency graph — the ones that must run before it. The positional id is a transform id. " +
    WORKTREE_SCOPE_DETAIL,
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformDependenciesEnvelope,
  examples: ["mb transform dependencies 1", "mb transform dependencies 1 --json"],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    if (scope !== null) {
      const transform = await client.transform.get(id);
      assertInWorktree("transform", id, transform.worktree_id, scope);
    }
    const { data } = await client.transform.dependencies(id);
    renderList(windowList(data, ctx.range), transformView, ctx);
  },
});
