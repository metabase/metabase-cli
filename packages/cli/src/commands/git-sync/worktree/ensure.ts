import { Worktree } from "@metabase/client/domain/worktree";
import { ConfigError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";

import { renderItem } from "../../../output/render";
import { worktreeView } from "../../../output/views/worktree";
import { outputFlags, preflightFlag } from "../../flags";
import { defineMetabaseCommand } from "../../runtime";

const BAD_REQUEST_STATUS = 400;

function isCreateRefused(error: unknown): boolean {
  return error instanceof HttpError && error.status === BAD_REQUEST_STATUS;
}

export default defineMetabaseCommand({
  meta: {
    name: "ensure",
    description: "Get the worktree for a branch, creating it when the branch has none",
  },
  requires: ["gitSync.worktrees", "gitSync.createWorktree"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    branch: {
      type: "string",
      description: "Branch the worktree checks out; it must exist on the remote",
      alias: "b",
      required: true,
    },
  },
  outputSchema: Worktree,
  examples: [
    "mb git-sync worktree ensure --branch feature/orders",
    "mb git-sync worktree ensure --branch feature/orders --json",
  ],
  async run({ args, ctx, getClient }) {
    const branch = args.branch;
    if (branch.trim() === "") {
      throw new ConfigError("--branch must name a branch");
    }
    const mb = await getClient();
    const findWorktree = async (): Promise<Worktree | null> => {
      const { data } = await mb.gitSync.worktrees();
      return data.find((worktree) => worktree.branch === branch) ?? null;
    };

    const existing = await findWorktree();
    if (existing !== null) {
      renderItem(existing, worktreeView, ctx);
      return;
    }
    // The server refuses a second worktree for a branch with a 400, so a create that loses a race
    // to another caller reads the list again and answers the winner's.
    let worktree: Worktree;
    try {
      worktree = await mb.gitSync.createWorktree({ branch });
    } catch (error) {
      const winner = isCreateRefused(error) ? await findWorktree() : null;
      if (winner === null) {
        throw error;
      }
      worktree = winner;
    }
    renderItem(worktree, worktreeView, ctx);
  },
});
