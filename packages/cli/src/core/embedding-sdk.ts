import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import {
  describeVersion,
  type ReleaseVersion,
  type ServerVersion,
} from "@metabase/client/version/tag";

import type { NpmDistTags } from "./npm-registry";
import { SemverString } from "./semver";

export const EMBEDDING_SDK_PACKAGE = "@metabase/embedding-sdk-react";

// npm tags each Metabase major's SDK by the major's number and a channel (`65-stable`). A major gains
// its stable tag only at its release, so until then its most mature pre-release is the SDK that matches.
const SDK_CHANNELS = ["stable", "beta", "alpha"] as const;

export const SdkRelease = z.object({
  tag: z.string(),
  version: SemverString,
});
export type SdkRelease = z.infer<typeof SdkRelease>;

export function requireReleaseBuild(server: ServerVersion): ReleaseVersion {
  if (server.kind === "development") {
    throw new ConfigError(
      `Metabase ${describeVersion(server)} matches no published ${EMBEDDING_SDK_PACKAGE} release — install an SDK built from the same Metabase source`,
    );
  }
  return server;
}

export function pickSdkRelease(server: ReleaseVersion, distTags: NpmDistTags): SdkRelease {
  const tags = SDK_CHANNELS.map((channel) => `${server.major}-${channel}`);
  for (const tag of tags) {
    const version = distTags[tag];
    if (version !== undefined) {
      return { tag, version };
    }
  }
  throw new ConfigError(
    `npm publishes no ${EMBEDDING_SDK_PACKAGE} tag for Metabase ${server.tag} (looked for ${tags.join(", ")})`,
  );
}
