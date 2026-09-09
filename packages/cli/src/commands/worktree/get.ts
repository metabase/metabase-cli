import { Worktree } from "@metabase/client/domain/worktree";

import { parseWorktreeRef } from "../../core/worktree-scope";
import { renderItem } from "../../output/render";
import { worktreeView } from "../../output/views/worktree";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { findWorktree, WORKTREE_REF_LABEL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get one git-sync worktree by id or branch" },
  capabilities: { minVersion: 64, tokenFeature: "remote_sync" },
  worktree: "any",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ref: { type: "positional", description: "Worktree id or branch name", required: true },
  },
  outputSchema: Worktree,
  examples: ["mb worktree get 3", "mb worktree get feat/transforms --json"],
  async run({ args, ctx, getClient }) {
    const ref = parseWorktreeRef(args.ref, WORKTREE_REF_LABEL);
    const worktree = await findWorktree(ref, await getClient());
    renderItem(worktree, worktreeView, ctx);
  },
});
