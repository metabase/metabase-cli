import { SessionProperties, type TokenFeatures } from "../domain/session-properties";
import type { Transport } from "../http/transport";

import { tryParseTag, type ParsedVersion } from "./tag";

export const PROBE_PATH = "/api/session/properties";
export const PROBE_TIMEOUT_MS = 10_000;

export interface ServerInfo {
  readonly version: ParsedVersion | null;
  readonly tokenFeatures: Readonly<TokenFeatures> | null;
}

interface ProbeOptions {
  retries?: number;
}

export async function probeServer(client: Transport, opts: ProbeOptions = {}): Promise<ServerInfo> {
  const properties = await client.requestParsed(SessionProperties, PROBE_PATH, {
    timeoutMs: PROBE_TIMEOUT_MS,
    retries: opts.retries ?? 0,
  });
  const version = tryParseTag(properties.version.tag);
  return {
    version,
    tokenFeatures: properties["token-features"] ?? null,
  };
}
