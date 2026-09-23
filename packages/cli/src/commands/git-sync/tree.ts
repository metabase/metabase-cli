import { SyncTree } from "@metabase/client/domain/git-sync";

import { renderSummary } from "../../output/render";
import { formatSyncTree, syncTreeView } from "../../output/views/git-sync";
import { outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "tree",
    description: "List the synced collections, their hierarchy, and the items in each",
  },
  requires: ["gitSync.syncedTree"],
  args: { ...outputFlags, ...preflightFlag },
  outputSchema: SyncTree,
  examples: ["mb git-sync tree", "mb git-sync tree --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const tree = await mb.gitSync.syncedTree();
    renderSummary(tree, syncTreeView, () => formatSyncTree(tree), ctx);
  },
});
