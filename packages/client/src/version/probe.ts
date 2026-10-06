import type { ZodType } from "zod";

import { SessionProperties, type TokenFeatures } from "../domain/session-properties";
import type { Transport } from "../http/transport";

import { type Edition, editionFromTag, parseTag, type ServerVersion } from "./tag";

export const PROBE_PATH = "/api/session/properties";
export const PROBE_TIMEOUT_MS = 10_000;

// `edition` is what the tag stamps, and null when the tag stamps nothing (`vUNKNOWN`); a
// `-SNAPSHOT` tag stamps it even though it names no release.
export interface ServerInfo {
  readonly version: ServerVersion;
  readonly edition: Edition | null;
  readonly date: string | null;
  readonly hash: string | null;
  readonly tokenFeatures: Readonly<TokenFeatures> | null;
}

interface ProbeOptions {
  timeoutMs?: number;
  retries?: number;
}

// The probe runs before a profile exists, so it asks only for the wire.
type ProbeTransport = Pick<Transport, "requestParsed">;

export async function probeServer(
  client: ProbeTransport,
  opts: ProbeOptions = {},
): Promise<ServerInfo> {
  return serverInfoFromProperties(await probeProperties(client, SessionProperties, opts));
}

// The session properties through `reader`, for a caller that wants a setting they carry beside the
// version and token features a probe reads.
export async function probeProperties<T extends SessionProperties>(
  client: ProbeTransport,
  reader: ZodType<T>,
  opts: ProbeOptions = {},
): Promise<T> {
  return client.requestParsed(reader, PROBE_PATH, {
    timeoutMs: opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    retries: opts.retries ?? 0,
  });
}

export function serverInfoFromProperties(properties: SessionProperties): ServerInfo {
  const { tag } = properties.version;
  return {
    version: parseTag(tag),
    edition: editionFromTag(tag),
    date: properties.version.date ?? null,
    hash: properties.version.hash ?? null,
    tokenFeatures: properties["token-features"] ?? null,
  };
}
