import { WORKSPACE_MANAGER_SCOPE } from "../http/oauth";
import { normalizeUrl } from "../url";

import type { ProfileRecord } from "./profile-record";
import { resolveRecordCredential } from "./storage";

export interface StaleApiKeyCredential {
  profile: string;
  kind: "apiKey";
}

export interface StaleOAuthCredential {
  profile: string;
  kind: "oauth";
  scope: string;
}

export type StaleCredential = StaleApiKeyCredential | StaleOAuthCredential;

// A credential is "stale" for workspace purposes when it targets the same parent instance and is
// broader than workspace CRUD: any API key (keys are unscoped, so full power) or any OAuth grant
// wider than the workspace-manager scope. The profile the command itself runs as is exempt — it
// is in deliberate use, not lying around.
export function findStaleParentCredentials(
  records: readonly ProfileRecord[],
  targetUrl: string,
  currentProfile: string,
): StaleCredential[] {
  const target = normalizeUrl(targetUrl);
  const stale: StaleCredential[] = [];
  for (const record of records) {
    if (record.name === currentProfile || normalizeUrl(record.url) !== target) {
      continue;
    }
    const resolved = resolveRecordCredential(record);
    if (resolved === null) {
      continue;
    }
    if (resolved.credential.kind === "apiKey") {
      stale.push({ profile: record.name, kind: "apiKey" });
    } else if (resolved.credential.scope !== WORKSPACE_MANAGER_SCOPE) {
      stale.push({ profile: record.name, kind: "oauth", scope: resolved.credential.scope });
    }
  }
  return stale;
}

export function describeStaleCredential(credential: StaleCredential): string {
  const detail = credential.kind === "apiKey" ? "api key" : credential.scope;
  return `${credential.profile} (${detail})`;
}
