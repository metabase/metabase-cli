import { z } from "zod";

import { clearRejection } from "../../core/auth/rejection";
import { clearProfile } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import type { ResourceView } from "../../domain/view";
import { promptConfirm } from "../../output/prompt";
import { renderItem } from "../../output/render";
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
        renderItem({ profile: profileName, cleared: false, aborted: true }, logoutView, ctx);
        return;
      }
    }

    const [cleared] = await Promise.all([clearProfile(profileName), clearRejection(profileName)]);
    renderItem({ profile: profileName, cleared, aborted: false }, logoutView, ctx);
  },
});
