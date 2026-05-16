import {
  parseTag,
  SessionProperties,
  type ParsedVersion,
  type TokenFeatures,
} from "../../domain/session-properties";
import type { Client } from "../http/client";

import { deriveEdition, type Edition } from "./edition";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_PATH = "/api/session/properties";

export interface ServerInfo {
  version: ParsedVersion | null;
  edition: Edition | null;
  tokenFeatures: Readonly<TokenFeatures> | null;
}

export const EMPTY_SERVER_INFO: ServerInfo = {
  version: null,
  edition: null,
  tokenFeatures: null,
};

export async function probeServer(client: Client): Promise<ServerInfo> {
  const properties = await client.requestParsed(SessionProperties, PROBE_PATH, {
    timeoutMs: PROBE_TIMEOUT_MS,
    retries: 0,
  });
  const version = parseTag(properties.version.tag);
  const tokenFeatures = properties["token-features"] ?? {};
  const edition = deriveEdition(version.build, tokenFeatures);
  return { version, edition, tokenFeatures };
}

export function createServerInfoCache(getClient: () => Promise<Client>): () => Promise<ServerInfo> {
  let cached: Promise<ServerInfo> | null = null;
  return () => {
    if (cached === null) {
      cached = (async () => {
        try {
          return await probeServer(await getClient());
        } catch {
          return EMPTY_SERVER_INFO;
        }
      })();
    }
    return cached;
  };
}
