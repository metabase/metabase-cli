import { SessionProperties, type TokenFeatures } from "../domain/session-properties";
import type { Transport } from "../http/transport";

import { type Edition, editionFromTag, tryParseTag, type ParsedVersion } from "./tag";

export const PROBE_PATH = "/api/session/properties";
export const PROBE_TIMEOUT_MS = 10_000;

// `edition` is what the tag stamps, and null when the tag stamps nothing (`vUNKNOWN`); a `-SNAPSHOT`
// tag stamps it even though it carries no usable version.
export interface ServerInfo {
  readonly version: ParsedVersion | null;
  readonly edition: Edition | null;
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
  return serverInfo(properties);
}

export function serverInfo(properties: SessionProperties): ServerInfo {
  const { tag } = properties.version;
  return {
    version: tryParseTag(tag),
    edition: editionFromTag(tag),
    date: properties.version.date ?? null,
    hash: properties.version.hash ?? null,
    tokenFeatures: properties["token-features"] ?? null,
  };
}
