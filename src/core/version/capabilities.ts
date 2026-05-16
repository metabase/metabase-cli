import { BASELINE_CAPABILITIES, type Capabilities, type Edition } from "../../runtime/capabilities";

import type { ServerInfo } from "./probe";

export { BASELINE_CAPABILITIES, type Capabilities, type Edition };

export function mergeCapabilities(overrides?: Partial<Capabilities>): Capabilities {
  if (overrides === undefined) {
    return BASELINE_CAPABILITIES;
  }
  return {
    minVersion: overrides.minVersion ?? BASELINE_CAPABILITIES.minVersion,
    edition: overrides.edition ?? BASELINE_CAPABILITIES.edition,
    ...(overrides.tokenFeature === undefined ? {} : { tokenFeature: overrides.tokenFeature }),
  };
}

export type PreflightReason =
  | "version-too-old"
  | "edition-mismatch"
  | "missing-token-feature"
  | "unknown-version";

export interface PreflightFailure {
  readonly reason: PreflightReason;
  readonly detail: string;
}

const EDITION_RANK: Readonly<Record<Edition, number>> = Object.freeze({
  oss: 0,
  pro: 1,
  enterprise: 2,
});

const VERSION_FLAVOR: Readonly<Record<"oss" | "ee", "0" | "1">> = Object.freeze({
  oss: "0",
  ee: "1",
});

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
    const flavor = VERSION_FLAVOR[info.version.build];
    return {
      reason: "version-too-old",
      detail: `This command requires Metabase v${flavor}.${required.minVersion}+ (this server is ${info.version.tag}). Upgrade Metabase or pin mb-cli to an older release.`,
    };
  }

  const actualEdition = info.edition ?? "oss";
  if (EDITION_RANK[actualEdition] < EDITION_RANK[required.edition]) {
    return {
      reason: "edition-mismatch",
      detail: `This command requires Metabase ${required.edition} (this server is ${actualEdition}). Upgrade your Metabase edition.`,
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
