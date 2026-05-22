import { z } from "zod";

import { clearProfile } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import type { ResourceView } from "../../domain/view";
import { promptConfirm } from "../../output/prompt";
import { renderSummary } from "../../output/render";
import { outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const LogoutResult = z.object({
  profile: z.string(),
  cleared: z.boolean(),
  aborted: z.boolean(),
});
export type LogoutResultJson = z.infer<typeof LogoutResult>;

const logoutView: ResourceView<LogoutResultJson> = {
  compactPick: LogoutResult,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "cleared", label: "Cleared" },
    { key: "aborted", label: "Aborted" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "logout", description: "Clear stored credentials for a profile" },
  capabilities: null,
  args: {
    ...outputFlags,
    ...profileFlag,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
  },
  outputSchema: LogoutResult,
  examples: ["mb auth logout --yes", "mb auth logout --profile staging --yes"],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);

    if (!args.yes && process.stdin.isTTY === true) {
      const ok = await promptConfirm({
        message: `Clear stored credentials for profile "${profileName}"?`,
        initialValue: false,
      });
      if (!ok) {
        renderSummary(
          { profile: profileName, cleared: false, aborted: true },
          logoutView,
          `Left credentials for profile "${profileName}" untouched.`,
          ctx,
        );
        return;
      }
    }

    const cleared = await clearProfile(profileName);
    const message = cleared
      ? `Cleared stored credentials for profile "${profileName}".`
      : `No stored credentials for profile "${profileName}".`;
    renderSummary({ profile: profileName, cleared, aborted: false }, logoutView, message, ctx);
  },
});
