import type { Client } from "@metabase/cli/client";
import { CurrentUserCompact } from "@metabase/cli/domain";
import { probeServer } from "@metabase/cli/version";

const CURRENT_USER_PATH = "/api/user/current";

export type Edition = "enterprise" | "oss";

export interface InstanceContext {
  url: string | null;
  versionTag: string | null;
  majorVersion: number | null;
  edition: Edition | null;
  tokenFeatures: string[] | null;
  user: CurrentUserCompact | null;
}

export const UNKNOWN_INSTANCE: InstanceContext = {
  url: null,
  versionTag: null,
  majorVersion: null,
  edition: null,
  tokenFeatures: null,
  user: null,
};

export async function probeInstance(client: Client, url: string): Promise<InstanceContext> {
  const [server, user] = await Promise.all([
    probeServer(client),
    client.requestParsed(CurrentUserCompact, CURRENT_USER_PATH),
  ]);
  return {
    url,
    versionTag: server.version === null ? null : server.version.tag,
    majorVersion: server.version === null ? null : server.version.major,
    edition: server.version === null ? null : editionOf(server.version.tag),
    tokenFeatures: server.tokenFeatures === null ? null : enabledFeatures(server.tokenFeatures),
    user,
  };
}

// Metabase publishes the same release twice: `v0.x` is the OSS build, `v1.x` the enterprise one.
// The token features say which paid features are *unlocked*; the tag says which jar is running.
function editionOf(tag: string): Edition | null {
  if (tag.startsWith("v1.")) {
    return "enterprise";
  }
  if (tag.startsWith("v0.")) {
    return "oss";
  }
  return null;
}

function enabledFeatures(features: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .toSorted();
}
