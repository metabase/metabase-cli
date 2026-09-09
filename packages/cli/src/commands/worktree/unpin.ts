import { z } from "zod";

import { readProfileRecord, writeProfileWorktree } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const WorktreeUnpinResult = z.object({
  profile: z.string(),
  unpinned: z.boolean(),
});
type WorktreeUnpinResult = z.infer<typeof WorktreeUnpinResult>;

const worktreeUnpinView: ResourceView<WorktreeUnpinResult> = {
  compactPick: WorktreeUnpinResult,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "unpinned", label: "Unpinned" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "unpin", description: "Release a profile's worktree pin" },
  capabilities: null,
  worktree: "any",
  args: { ...outputFlags, ...profileFlag },
  outputSchema: WorktreeUnpinResult,
  examples: ["mb worktree unpin", "mb worktree unpin --profile agent --json"],
  async run({ args, ctx }) {
    const profile = resolveProfileName(args.profile);
    const pin = (await readProfileRecord(profile))?.worktree ?? null;
    if (pin !== null) {
      await writeProfileWorktree(profile, null);
    }
    const result: WorktreeUnpinResult = { profile, unpinned: pin !== null };
    const text =
      pin === null
        ? `Profile "${profile}" is not pinned to a worktree.`
        : `Unpinned profile "${profile}" from worktree ${pin.id} (${pin.branch}).`;
    renderSummary(result, worktreeUnpinView, text, ctx);
  },
});
