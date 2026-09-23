import { z } from "zod";

import { MetabaseError } from "../errors";

import { FEATURE_NAMES } from "./features";

export const RequirementReason = z.enum([
  "version-too-old",
  "version-too-new",
  "missing-token-feature",
]);
export type RequirementReason = z.infer<typeof RequirementReason>;

// The feature a client method needed and the profile lacked, with the rule that decided it, so a
// consumer can explain the refusal without re-reading the feature table. A schema rather than a
// bare type because a consumer that reports the refusal in its own output wants to describe it.
export const RequirementFailure = z.object({
  reason: RequirementReason,
  detail: z.string(),
  feature: z.enum(FEATURE_NAMES),
  since: z.number().int(),
  tokenFeature: z.string().nullable(),
  serverVersion: z.string().nullable(),
});
export type RequirementFailure = z.infer<typeof RequirementFailure>;

export function versionTooOldMessage(since: number, serverVersion: string | null): string {
  const server =
    serverVersion === null ? "this server's version is unknown" : `this server is ${serverVersion}`;
  return `This operation requires Metabase v${since}+ (${server}). Upgrade Metabase to use it.`;
}

export function versionTooNewMessage(
  since: number,
  until: number,
  serverVersion: string | null,
): string {
  const server =
    serverVersion === null ? "this server's version is unknown" : `this server is ${serverVersion}`;
  return `This operation exists on Metabase v${since} through v${until} only (${server}); later releases removed it.`;
}

export function missingTokenFeatureMessage(tokenFeature: string): string {
  return `This operation requires the '${tokenFeature}' premium feature (not enabled on this server).`;
}

export class CapabilityError extends MetabaseError {
  readonly category = "capability";
  readonly isRetryable = false;
  readonly developerDetail: RequirementFailure;

  constructor(failure: RequirementFailure) {
    super(failure.detail);
    this.name = "CapabilityError";
    this.developerDetail = failure;
  }
}
