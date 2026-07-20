import { z } from "zod";

import { revokeOAuthCredential } from "../../core/auth/oauth-session";
import {
  clearProfile,
  consumeKeychainResidualWarning,
  readProfileCredential,
} from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import { errorMessage } from "../../core/errors";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
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
  capabilities: { minVersion: 58 },
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

    // Read the credential before clearing so we can still revoke it afterward.
    const resolved = await readProfileCredential(profileName);

    const cleared = await clearProfile(profileName);
    const residual = consumeKeychainResidualWarning();
    if (residual !== null) {
      warn(residual);
    }

    // Best-effort server-side revocation AFTER the durable local clear, so a slow/offline server
    // never blocks (or hangs) the logout. A revocation failure only warns.
    if (resolved !== null && resolved.credential.kind === "oauth") {
      try {
        const revoked = await revokeOAuthCredential(resolved.url, resolved.credential);
        if (!revoked) {
          warn(
            "server does not advertise a revocation endpoint; tokens remain valid until they expire",
          );
        }
      } catch (error) {
        warn(`could not revoke tokens server-side: ${errorMessage(error)}`);
      }
    }

    const message = cleared
      ? `Cleared stored credentials for profile "${profileName}".`
      : `No stored credentials for profile "${profileName}".`;
    renderSummary({ profile: profileName, cleared, aborted: false }, logoutView, message, ctx);
  },
});
