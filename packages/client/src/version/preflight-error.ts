import { z } from "zod";

import { MetabaseError } from "../errors";
import type { HttpError } from "../http/errors";

import { FEATURE_NAMES } from "./features";

// The one refusal status that is also an ordinary validation failure: a server lacking a parameter's
// feature rejects the unknown parameter with it, and so does any server rejecting a bad value.
const BAD_REQUEST_STATUS = 400;

export const RequirementReason = z.enum(["version-too-old", "missing-token-feature"]);
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
  serverVersion: z.string(),
});
export type RequirementFailure = z.infer<typeof RequirementFailure>;

export function versionTooOldMessage(since: number, serverVersion: string): string {
  return `This operation requires Metabase v${since}+ (this server is ${serverVersion}). Upgrade Metabase to use it.`;
}

export function missingTokenFeatureMessage(tokenFeature: string): string {
  return `This operation requires the '${tokenFeature}' premium feature (not enabled on this server).`;
}

// An explained refusal carries the server's answer as its `cause`. A 400 may have rejected the call
// for a reason other than the missing feature, so its message also quotes what the server said; a
// 402 or an unrouted 404 says nothing the requirement does not. The field errors stay structured on
// the cause rather than being re-rendered here.
export class CapabilityError extends MetabaseError {
  readonly category = "capability";
  readonly isRetryable = false;
  readonly developerDetail: RequirementFailure;

  constructor(failure: RequirementFailure, refusal: HttpError | null = null) {
    super(capabilityMessage(failure, refusal), refusal === null ? undefined : { cause: refusal });
    this.name = "CapabilityError";
    this.developerDetail = failure;
  }
}

function capabilityMessage(failure: RequirementFailure, refusal: HttpError | null): string {
  if (refusal === null || refusal.status !== BAD_REQUEST_STATUS) {
    return failure.detail;
  }
  return `${failure.detail}\nMetabase answered ${refusal.status}: ${refusal.message}`;
}
