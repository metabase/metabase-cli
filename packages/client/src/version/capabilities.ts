import { z } from "zod";

import type { ServerInfo } from "./probe";

export const Capabilities = z.object({
  minVersion: z.number(),
  tokenFeature: z.string().optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const BASELINE_CAPABILITIES: Capabilities = Object.freeze({
  minVersion: 58,
});

export function mergeCapabilities(overrides?: Partial<Capabilities>): Capabilities {
  if (overrides === undefined) {
    return BASELINE_CAPABILITIES;
  }
  return {
    minVersion: overrides.minVersion ?? BASELINE_CAPABILITIES.minVersion,
    ...(overrides.tokenFeature === undefined ? {} : { tokenFeature: overrides.tokenFeature }),
  };
}

type PreflightReason = "version-too-old" | "missing-token-feature" | "unknown-version";

export interface PreflightFailure {
  readonly reason: PreflightReason;
  readonly detail: string;
}

export function checkCapabilities(
  info: ServerInfo,
  required: Capabilities,
): PreflightFailure | null {
  if (info.version === null) {
    return {
      reason: "unknown-version",
      detail:
        "Could not detect Metabase server version. Proceeding without preflight check; failures may produce confusing errors.",
    };
  }

  if (info.version.major < required.minVersion) {
    return {
      reason: "version-too-old",
      detail: `This operation requires Metabase v${required.minVersion}+ (this server is ${info.version.tag}). Upgrade Metabase to use it.`,
    };
  }

  if (required.tokenFeature !== undefined) {
    const enabled = info.tokenFeatures?.[required.tokenFeature] === true;
    if (!enabled) {
      return {
        reason: "missing-token-feature",
        detail: `This operation requires the '${required.tokenFeature}' premium feature (not enabled on this server).`,
      };
    }
  }

  return null;
}
