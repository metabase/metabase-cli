import { z } from "zod";

import {
  listProfileRecords,
  readProfile,
  writeProbeFailure,
  writeProbeResult,
} from "../../core/auth/storage";
import { verifyAndProbe, type VerifyFailure } from "../../core/auth/verify";
import { originOnly } from "../../core/url";
import type { ServerInfo } from "../../core/version/probe";
import {
  ProbedUser,
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
import { renderTimestamp, renderUserRole, renderVersionTag } from "./render";
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
    const verifications = await Promise.all(records.map(verifyOne));
    const items: AuthProfileJson[] = [];
    for (const entry of verifications) {
      items.push(await persistAndProject(entry));
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
  const profile = await readProfile(record.name);
  if (profile === null) {
    return { record, url: record.url, verification: { kind: "no-creds" } };
  }
  const result = await verifyAndProbe(profile.url, profile.apiKey);
  if (result.ok) {
    return {
      record,
      url: profile.url,
      verification: { kind: "success", user: result.user, server: result.server },
    };
  }
  return { record, url: profile.url, verification: { kind: "failure", failure: result } };
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
    return projectSuccess(record.name, url, probe);
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

function projectSuccess(name: string, url: string, probe: ProfileLastProbe): AuthProfileJson {
  return {
    profile: name,
    url: originOnly(url),
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
    url: originOnly(record.url),
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
