import { SyncBranchCreated } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";

import { renderSummary } from "../../output/render";
import { syncBranchCreatedView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "create-branch",
    description: "Create a new branch on the git remote and switch git-sync to it",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    name: { type: "positional", description: "Branch name", required: true },
  },
  outputSchema: SyncBranchCreated,
  examples: [
    "mb git-sync create-branch feat/dashboards",
    "mb git-sync create-branch feat/x --json",
  ],
  async run({ args, ctx, getClient }) {
    const name = args.name.trim();
    if (name === "") {
      throw new ConfigError("invalid name: branch name must not be blank");
    }
    const mb = await getClient();
    const result = await mb.gitSync.createBranch({ name });
    renderSummary(
      result,
      syncBranchCreatedView,
      `Created branch "${name}" and switched git-sync to it.`,
      ctx,
    );
  },
});
