import type { ServerProfile } from "@metabase/client/version/profile";

import type { ServerSummary } from "../contracts/settings";

export function serverSummary(profile: ServerProfile): ServerSummary {
  const placed = profile.version !== null;
  return {
    version: profile.version === null ? null : profile.version.tag,
    edition: placed ? profile.edition : null,
    features: {
      remoteSync: profile.features.remoteSync,
      transforms: profile.features.transforms,
      transformTests: profile.features.transformTests,
    },
  };
}
