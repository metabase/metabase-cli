import { BASELINE_CAPABILITIES, type Capabilities } from "../../runtime/capabilities";

import type { ServerInfo } from "./probe";

export { BASELINE_CAPABILITIES, type Capabilities };

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
      detail: `This command requires Metabase v${required.minVersion}+ (this server is ${info.version.tag}). Upgrade Metabase or pin mb-cli to an older release.`,
    };
  }

  if (required.tokenFeature !== undefined) {
    const enabled = info.tokenFeatures?.[required.tokenFeature] === true;
    if (!enabled) {
      return {
        reason: "missing-token-feature",
        detail: `This command requires the '${required.tokenFeature}' premium feature (not enabled on this server).`,
      };
    }
  }

  return null;
}
