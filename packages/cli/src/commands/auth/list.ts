import { z } from "zod";

import {
  listProfileRecords,
  resolveRecordCredential,
  writeProbeFailure,
  writeProbeResult,
} from "../../core/auth/storage";
import { verifyAndProbe, type VerifyFailure } from "../../core/auth/verify";
import { createCredentialRefresher } from "../../core/config";
import { displayUrl } from "../../core/url";
import type { ServerInfo } from "../../core/version/probe";
import {
  ProbedUser,
  profileAuthMethod,
  ProfileAuthMethod,
  ProfileLastFailure,
  ProfileLastProbe,
  type ProfileRecord,
} from "../../core/auth/profile-record";
import { TokenFeatures } from "../../domain/session-properties";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { ParsedVersionSchema } from "../../core/version/tag";
import { outputFlags } from "../flags";
import { renderAuthMethod, renderTimestamp, renderUserRole, renderVersionTag } from "./render";
import { defineMetabaseCommand } from "../runtime";

const AuthProfileStatus = z.enum([
  "ok",
  "auth-failed",
  "network-error",
  "server-error",
  "not-probed",
]);
export type AuthProfileStatusValue = z.infer<typeof AuthProfileStatus>;

export const AuthProfile = z.object({
  profile: z.string(),
  url: z.string(),
  method: ProfileAuthMethod,
  authenticated: z.boolean(),
  status: AuthProfileStatus,
  user: ProbedUser.nullable(),
  version: ParsedVersionSchema.nullable(),
  tokenFeatures: TokenFeatures.nullable(),
  lastProbedAt: z.iso.datetime().nullable(),
  lastFailure: ProfileLastFailure.nullable(),
});
export type AuthProfileJson = z.infer<typeof AuthProfile>;

export const AuthProfileListEnvelope = listEnvelopeSchema(AuthProfile);

const STATUS_LABEL: Readonly<Record<AuthProfileStatusValue, string>> = Object.freeze({
  ok: "OK",
  "auth-failed": "Auth failed",
  "network-error": "Network error",
  "server-error": "Server error",
  "not-probed": "Not probed",
});

const authProfileView: ResourceView<AuthProfileJson> = {
  compactPick: AuthProfile,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "url", label: "URL" },
    { key: "method", label: "Auth", format: (value) => renderAuthMethod(value) },
    { key: "status", label: "Status", format: (value) => renderStatus(value) },
    { key: "user", label: "Role", format: (value) => renderUserRole(value) },
    { key: "version", label: "Version", format: (value) => renderVersionTag(value) },
    { key: "lastProbedAt", label: "Last probed", format: (value) => renderTimestamp(value) },
  ],
};

function renderStatus(value: unknown): string {
  const parsed = AuthProfileStatus.safeParse(value);
  return parsed.success ? STATUS_LABEL[parsed.data] : "—";
}

export default defineMetabaseCommand({
  meta: { name: "list", description: "List configured authentication profiles" },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags },
  outputSchema: AuthProfileListEnvelope,
  examples: ["mb auth list", "mb auth list --json"],
  async run({ ctx }) {
    const records = await listProfileRecords();
    // Verify and persist one profile at a time: a verify can refresh+rewrite an expired OAuth
    // token, so serializing avoids two profiles racing on the shared profiles.json.
    const items: AuthProfileJson[] = [];
    for (const record of records) {
      items.push(await persistAndProject(await verifyOne(record)));
    }
    renderList(wrapList(items), authProfileView, ctx);

    for (const item of items) {
      if (item.status === "auth-failed" && item.lastFailure !== null) {
        warn(
          `${item.profile}: ${item.lastFailure.reason}. Run \`mb auth login --profile ${item.profile}\` to update the token.`,
        );
      }
    }
  },
});

interface VerificationEntry {
  record: ProfileRecord;
  url: string;
  verification: VerificationOutcome;
}

interface NoCredsOutcome {
  kind: "no-creds";
}

interface SuccessOutcome {
  kind: "success";
  user: ProbedUser;
  server: ServerInfo;
}

interface FailureOutcome {
  kind: "failure";
  failure: VerifyFailure;
}

type VerificationOutcome = NoCredsOutcome | SuccessOutcome | FailureOutcome;

async function verifyOne(record: ProfileRecord): Promise<VerificationEntry> {
  // Resolve from the record already in hand (listProfileRecords loaded it) rather than re-reading
  // and re-parsing the whole profiles.json once per profile.
  const resolved = resolveRecordCredential(record);
  if (resolved === null) {
    return { record, url: record.url, verification: { kind: "no-creds" } };
  }
  // Pass a refresher so an expired-but-refreshable OAuth profile self-heals on the 401 probe
  // instead of being reported as auth-failed.
  const result = await verifyAndProbe(
    resolved.url,
    resolved.credential,
    createCredentialRefresher(record.name),
  );
  if (result.ok) {
    return {
      record,
      url: resolved.url,
      verification: { kind: "success", user: result.user, server: result.server },
    };
  }
  return { record, url: resolved.url, verification: { kind: "failure", failure: result } };
}

async function persistAndProject(entry: VerificationEntry): Promise<AuthProfileJson> {
  const { record, url, verification } = entry;
  if (verification.kind === "no-creds") {
    return toJson(record, "not-probed");
  }
  if (verification.kind === "success") {
    const probe = await writeProbeResult(record.name, {
      user: verification.user,
      server: verification.server,
    });
    if (probe === null) {
      return toJson(record, "not-probed");
    }
    return projectSuccess(record, url, probe);
  }
  const failure = await writeProbeFailure(record.name, {
    kind: verification.failure.kind,
    reason: verification.failure.message,
  });
  if (failure === null) {
    return toJson(record, "not-probed");
  }
  return toJson({ ...record, lastFailure: failure }, statusFromVerification(verification.failure));
}

function projectSuccess(
  record: ProfileRecord,
  url: string,
  probe: ProfileLastProbe,
): AuthProfileJson {
  return {
    profile: record.name,
    url: displayUrl(url),
    method: profileAuthMethod(record),
    authenticated: true,
    status: "ok",
    user: probe.user,
    version: probe.version,
    tokenFeatures: probe.tokenFeatures,
    lastProbedAt: probe.at,
    lastFailure: null,
  };
}

function toJson(record: ProfileRecord, status: AuthProfileStatusValue): AuthProfileJson {
  const probe = record.lastProbe;
  return {
    profile: record.name,
    url: displayUrl(record.url),
    method: profileAuthMethod(record),
    authenticated: status === "ok",
    status,
    user: probe?.user ?? null,
    version: probe?.version ?? null,
    tokenFeatures: probe?.tokenFeatures ?? null,
    lastProbedAt: probe?.at ?? null,
    lastFailure: record.lastFailure,
  };
}

function statusFromVerification(failure: VerifyFailure): AuthProfileStatusValue {
  if (failure.kind === "auth") {
    return "auth-failed";
  }
  if (failure.kind === "network") {
    return "network-error";
  }
  return "server-error";
}
