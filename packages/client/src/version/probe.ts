import { SessionProperties, type TokenFeatures } from "../domain/session-properties";
import type { Transport } from "../http/transport";

import { tryParseTag, type ParsedVersion } from "./tag";

export const PROBE_PATH = "/api/session/properties";
export const PROBE_TIMEOUT_MS = 10_000;

export interface ServerInfo {
  readonly version: ParsedVersion | null;
  readonly date: string | null;
  readonly hash: string | null;
  readonly tokenFeatures: Readonly<TokenFeatures> | null;
}

interface ProbeOptions {
  retries?: number;
}

// The probe runs before a profile exists, so it asks only for the wire and never for `require`.
type ProbeTransport = Pick<Transport, "requestParsed">;

export async function probeServer(
  client: ProbeTransport,
  opts: ProbeOptions = {},
): Promise<ServerInfo> {
  const properties = await client.requestParsed(SessionProperties, PROBE_PATH, {
    timeoutMs: PROBE_TIMEOUT_MS,
    retries: opts.retries ?? 0,
  });
  const version = tryParseTag(properties.version.tag);
  return {
    version,
    date: properties.version.date ?? null,
    hash: properties.version.hash ?? null,
    tokenFeatures: properties["token-features"] ?? null,
  };
}
