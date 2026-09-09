import { CollectionCompact, CollectionListFilter } from "@metabase/client/domain/collection";

import { collectionView } from "../../output/views/collection";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const CollectionListEnvelope = listEnvelopeSchema(CollectionCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List collections" },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    filter: {
      type: "string",
      description: `Filter preset: ${CollectionListFilter.options.join("|")}`,
      default: "all",
    },
  },
  outputSchema: CollectionListEnvelope,
  examples: [
    "mb collection list",
    "mb collection list --json",
    "mb collection list --filter archived --json",
    "mb collection list --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const filter = parseEnumFlag(args.filter, CollectionListFilter, "filter");
    const client = await getClient();
    const scope = await getWorktree();
    const collections = await client.collection.list({ filter, ...scopeQuery(scope) });
    renderList(windowList(collections.data, ctx.range), collectionView, ctx);
  },
});
