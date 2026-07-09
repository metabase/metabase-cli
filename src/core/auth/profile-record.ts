import { z } from "zod";

import { TokenFeatures } from "../../domain/session-properties";
import { OAUTH_SCOPE } from "../http/oauth";
import { ParsedVersionSchema } from "../version/tag";

export const ProbedUser = z.object({
  id: z.number().int(),
  name: z.string(),
  isAdmin: z.boolean(),
});
export type ProbedUser = z.infer<typeof ProbedUser>;

export const ProfileLastProbe = z.object({
  at: z.iso.datetime(),
  version: ParsedVersionSchema.nullable(),
  tokenFeatures: TokenFeatures.nullable(),
  user: ProbedUser,
});
export type ProfileLastProbe = z.infer<typeof ProfileLastProbe>;

export const ProfileFailureKind = z.enum(["auth", "network", "server"]);
export type ProfileFailureKind = z.infer<typeof ProfileFailureKind>;

export const ProfileLastFailure = z.object({
  at: z.iso.datetime(),
  kind: ProfileFailureKind,
  reason: z.string(),
});
export type ProfileLastFailure = z.infer<typeof ProfileLastFailure>;

// Non-secret OAuth credential metadata persisted in the profile record. The access/refresh tokens
// themselves live in the OS keychain when available; `accessToken`/`refreshToken` are inlined here
// only as the plaintext-file fallback, mirroring how `apiKey` is handled.
export const ProfileOAuth = z
  .object({
    accessToken: z.string().nullable(),
    refreshToken: z.string().nullable(),
    expiresAt: z.iso.datetime(),
    clientId: z.string(),
    // Records written before scoped logins existed were all minted with the full-access scope,
    // so defaulting an absent field to it is a fact, not a guess.
    scope: z.string().default(OAUTH_SCOPE),
  })
  .loose();
export type ProfileOAuth = z.infer<typeof ProfileOAuth>;

export const ProfileAuthMethod = z.enum(["oauth", "apiKey"]);
export type ProfileAuthMethod = z.infer<typeof ProfileAuthMethod>;

// `.loose()` so fields written by a newer CLI survive an older CLI's read-modify-write of the
// shared profiles.json. Every write path round-trips the whole file; a strict-strip schema would
// silently drop unknown keys (e.g. a future `oauth`-style block) and force a re-login.
export const ProfileRecord = z
  .object({
    name: z.string(),
    url: z.string(),
    apiKey: z.string().nullable(),
    oauth: ProfileOAuth.nullable().default(null),
    lastProbe: ProfileLastProbe.nullable(),
    lastFailure: ProfileLastFailure.nullable(),
  })
  .loose();
export type ProfileRecord = z.infer<typeof ProfileRecord>;

export const ProfilesFile = z
  .object({
    profiles: z.array(ProfileRecord),
  })
  .loose();
export type ProfilesFile = z.infer<typeof ProfilesFile>;

// Which mechanism the profile is configured with — not whether its secret currently resolves.
export function profileAuthMethod(record: ProfileRecord): ProfileAuthMethod {
  return record.oauth !== null ? "oauth" : "apiKey";
}
