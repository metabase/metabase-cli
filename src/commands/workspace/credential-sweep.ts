import { revokeOAuthCredential } from "../../core/auth/oauth-session";
import {
  describeStaleCredential,
  findStaleParentCredentials,
  type StaleCredential,
} from "../../core/auth/stale-credentials";
import { clearProfile, listProfileRecords, readProfileCredential } from "../../core/auth/storage";
import { ConfigError, errorMessage } from "../../core/errors";
import { warn } from "../../output/notice";
import { promptConfirm } from "../../output/prompt";

export const keepExistingAuthFlag = {
  keepExistingAuth: {
    type: "boolean",
    description:
      "Proceed despite broader same-server credentials in the profile store (interactive only)",
    alias: "keep-existing-auth",
    default: false,
  },
} as const;

export interface CredentialSweepInput {
  url: string;
  profile: string;
  keepExistingAuth: boolean;
  action: string;
}

// Tier 2 of the containment ladder: a stale full-power credential for the same parent would let a
// confused agent bypass the workspace-scoped token, so workspace create/connect refuses to proceed
// while one exists. Interactive runs offer revocation; non-interactive (agent) runs hard-refuse —
// the override is deliberately human-only.
export async function enforceCredentialSweep(input: CredentialSweepInput): Promise<void> {
  const records = await listProfileRecords();
  const stale = findStaleParentCredentials(records, input.url, input.profile);
  if (stale.length === 0) {
    return;
  }
  const listing = stale.map(describeStaleCredential).join(", ");
  const interactive = process.stdin.isTTY === true;

  if (input.keepExistingAuth) {
    if (!interactive) {
      throw new ConfigError(
        "--keep-existing-auth requires an interactive terminal; refusing to proceed with broader credentials in a non-interactive context",
      );
    }
    warn(`proceeding with broader credentials left in the profile store: ${listing}`);
    return;
  }

  if (!interactive) {
    throw new ConfigError(
      `refusing to ${input.action}: broader credentials for this server exist in the profile store (${listing}) — revoke them with \`mb auth logout --profile <name>\` first; a human can override with --keep-existing-auth`,
    );
  }

  const ok = await promptConfirm({
    message: `Broader credentials for this server exist (${listing}). Revoke them before continuing?`,
    initialValue: true,
  });
  if (!ok) {
    throw new ConfigError(
      `aborted: revoke the broader credentials (${listing}) with \`mb auth logout --profile <name>\` or pass --keep-existing-auth`,
    );
  }
  for (const credential of stale) {
    await revokeStaleCredential(credential);
  }
}

// Mirrors logout: durable local clear first, then best-effort server-side revocation for OAuth.
// API keys cannot be revoked from here — the server-side key must be deleted in Admin settings.
async function revokeStaleCredential(stale: StaleCredential): Promise<void> {
  const resolved = await readProfileCredential(stale.profile);
  await clearProfile(stale.profile);
  if (resolved === null || resolved.credential.kind !== "oauth") {
    warn(
      `cleared profile "${stale.profile}"; its API key is still active server-side — delete it in Admin settings → Authentication → API keys`,
    );
    return;
  }
  try {
    const revoked = await revokeOAuthCredential(resolved.url, resolved.credential);
    if (!revoked) {
      warn(
        `cleared profile "${stale.profile}", but the server advertises no revocation endpoint; its tokens remain valid until they expire`,
      );
    }
  } catch (error) {
    warn(
      `cleared profile "${stale.profile}", but revoking server-side failed: ${errorMessage(error)}`,
    );
  }
}
