import { z } from "zod";

import { ProfilePin } from "../../core/auth/profile-record";
import { writeProfileWorktree } from "../../core/auth/storage";
import { parseWorktreeRef } from "../../core/worktree-scope";
import { renderSummary } from "../../output/render";
import { EMPTY_CELL } from "../../output/table";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { findWorktree, WORKTREE_REF_LABEL } from "../worktree-scope";

export const WorktreePinResult = z.object({
  profile: z.string(),
  worktree: ProfilePin,
});
type WorktreePinResult = z.infer<typeof WorktreePinResult>;

const worktreePinView: ResourceView<WorktreePinResult> = {
  compactPick: WorktreePinResult,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "worktree", label: "Worktree", format: (value) => renderPin(value) },
  ],
};

function renderPin(value: unknown): string {
  const parsed = ProfilePin.safeParse(value);
  return parsed.success ? `${parsed.data.id} (${parsed.data.branch})` : EMPTY_CELL;
}

export default defineMetabaseCommand({
  meta: {
    name: "pin",
    description: "Confine every command run under this profile to one worktree",
  },
  capabilities: { minVersion: 64, tokenFeature: "remote_sync" },
  worktree: "any",
  details:
    "The pin is a lock, not a default: while it stands, --worktree and MB_WORKTREE may only re-state it, " +
    "and commands that change main-app content refuse to run.",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ref: { type: "positional", description: "Worktree id or branch name", required: true },
  },
  outputSchema: WorktreePinResult,
  examples: ["mb worktree pin 3", "mb worktree pin feat/transforms --profile agent"],
  async run({ args, ctx, getClient, getResolvedConfig }) {
    const ref = parseWorktreeRef(args.ref, WORKTREE_REF_LABEL);
    const worktree = await findWorktree(ref, await getClient());
    const profile = (await getResolvedConfig()).profile;
    const pin: ProfilePin = { id: worktree.id, branch: worktree.branch };
    await writeProfileWorktree(profile, pin);

    const result: WorktreePinResult = { profile, worktree: pin };
    renderSummary(
      result,
      worktreePinView,
      `Pinned profile "${profile}" to worktree ${pin.id} (${pin.branch}).`,
      ctx,
    );
  },
});
