import { SessionProperties, type TokenFeatures } from "../domain/session-properties";
import type { Transport } from "../http/transport";

import { createServerProfile, type ServerProfile } from "./profile";
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

export interface ProbeOptions {
  timeoutMs?: number;
  retries?: number;
}

export interface ProbeBudget {
  timeoutMs: number;
  retries: number;
}

// The probe runs before a profile exists, so it asks only for the wire.
type ProbeTransport = Pick<Transport, "requestParsed">;

export async function probeServer(
  client: ProbeTransport,
  opts: ProbeOptions = {},
): Promise<ServerInfo> {
  return serverInfoFromProperties(
    await client.requestParsed(SessionProperties, PROBE_PATH, probeBudget(opts)),
  );
}

export function probeBudget(opts: ProbeOptions): ProbeBudget {
  return {
    timeoutMs: opts.timeoutMs ?? PROBE_TIMEOUT_MS,
    retries: opts.retries ?? 0,
  };
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

// The profile one read of the session properties describes, for a call judged by its own read
// rather than by whichever probe is newest by the time it asks.
export function profileFromProperties(properties: SessionProperties): ServerProfile {
  return createServerProfile(serverInfoFromProperties(properties));
}
