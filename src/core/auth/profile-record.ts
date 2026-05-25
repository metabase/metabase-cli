import { z } from "zod";

import { TokenFeatures } from "../../domain/session-properties";
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

export const ProfileRecord = z.object({
  name: z.string(),
  url: z.string(),
  apiKey: z.string().nullable(),
  lastProbe: ProfileLastProbe.nullable(),
  lastFailure: ProfileLastFailure.nullable(),
});
export type ProfileRecord = z.infer<typeof ProfileRecord>;

export const ProfilesFile = z.object({
  profiles: z.array(ProfileRecord),
});
export type ProfilesFile = z.infer<typeof ProfilesFile>;
