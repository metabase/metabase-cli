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
  worktree: "main-only",
  details:
    "The instance switches to the new branch unless --no-checkout, which creates it on the remote and leaves git-sync where it is — what `mb worktree create` does before checking the branch out into a worktree.",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    name: { type: "positional", description: "Branch name", required: true },
    checkout: {
      type: "boolean",
      description:
        "Switch git-sync to the new branch (default: true; --no-checkout only creates it)",
      default: true,
    },
  },
  outputSchema: SyncBranchCreated,
  examples: [
    "mb git-sync create-branch feat/dashboards",
    "mb git-sync create-branch feat/x --json",
    "mb git-sync create-branch feat/x --no-checkout",
  ],
  async run({ args, ctx, getClient }) {
    const name = args.name.trim();
    if (name === "") {
      throw new ConfigError("invalid name: branch name must not be blank");
    }
    const mb = await getClient();
    const result = await mb.gitSync.createBranch({ name, checkout: args.checkout });
    const message = args.checkout
      ? `Created branch "${name}" and switched git-sync to it.`
      : `Created branch "${name}".`;
    renderSummary(result, syncBranchCreatedView, message, ctx);
  },
});
