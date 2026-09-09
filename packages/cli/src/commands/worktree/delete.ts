import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";

import { readProfileRecord, writeProfileWorktree } from "../../core/auth/storage";
import { parseWorktreeRef } from "../../core/worktree-scope";
import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { findWorktree, WORKTREE_REF_LABEL } from "../worktree-scope";

export const WorktreeDeleteResult = z.object({
  id: z.number().int().positive(),
  branch: z.string(),
  deleted: z.literal(true),
  unpinned: z.boolean(),
});
type WorktreeDeleteResult = z.infer<typeof WorktreeDeleteResult>;

const worktreeDeleteView: ResourceView<WorktreeDeleteResult> = {
  compactPick: WorktreeDeleteResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "branch", label: "Branch" },
    { key: "deleted", label: "Deleted" },
    { key: "unpinned", label: "Unpinned" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "delete",
    description: "Delete a git-sync worktree and every piece of content checked out into it",
  },
  capabilities: { minVersion: 64, tokenFeature: "remote_sync" },
  worktree: "any",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ref: { type: "positional", description: "Worktree id or branch name", required: true },
    force: {
      type: "boolean",
      description: "Delete even when the worktree holds unpushed changes (LOSSY)",
      default: false,
    },
  },
  outputSchema: WorktreeDeleteResult,
  examples: ["mb worktree delete 3", "mb worktree delete feat/transforms --force --json"],
  async run({ args, ctx, getClient, getResolvedConfig, getWorktree }) {
    const ref = parseWorktreeRef(args.ref, WORKTREE_REF_LABEL);
    const mb = await getClient();
    const worktree = await findWorktree(ref, mb);

    const scope = await getWorktree();
    if (scope !== null && scope.id !== worktree.id) {
      throw new ConfigError(
        `this session is scoped to worktree ${scope.id} (${scope.branch}); ` +
          `refusing to delete worktree ${worktree.id} (${worktree.branch})`,
      );
    }
    if (!args.force && (await mb.gitSync.isDirty({ "worktree-id": worktree.id }))) {
      throw new ConfigError(
        `worktree ${worktree.id} (${worktree.branch}) has unpushed changes; ` +
          "push them with `mb git-sync export` or pass --force to discard",
      );
    }

    await mb.gitSync.deleteWorktree(worktree.id);

    const profile = (await getResolvedConfig()).profile;
    const pin = (await readProfileRecord(profile))?.worktree ?? null;
    const unpinned = pin !== null && pin.id === worktree.id;
    if (unpinned) {
      await writeProfileWorktree(profile, null);
    }

    const result: WorktreeDeleteResult = {
      id: worktree.id,
      branch: worktree.branch,
      deleted: true,
      unpinned,
    };
    renderSummary(result, worktreeDeleteView, summarize(result, profile), ctx);
  },
});

function summarize(result: WorktreeDeleteResult, profile: string): string {
  const deleted = `Deleted worktree ${result.id} (${result.branch}) and its content.`;
  return result.unpinned ? `${deleted}\nUnpinned profile "${profile}".` : deleted;
}
