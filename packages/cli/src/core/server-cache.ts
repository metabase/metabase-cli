import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { TokenFeatures } from "@metabase/client/domain/session-properties";
import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJsonResult } from "@metabase/client/json";
import type { ServerInfo } from "@metabase/client/version/probe";
import { Edition, ParsedVersion } from "@metabase/client/version/tag";

import { cacheDir } from "./paths";

export const PROBE_CACHE_TTL_MS = 60 * 60 * 1000;
const URL_HASH_LENGTH = 16;
const CACHE_FILE_MODE = 0o600;
const CACHE_DIR_MODE = 0o700;

// The raw probe and nothing derived from it, so a profile built from a cached entry is always the
// running CLI's own reading.
const CachedProbe = z.object({
  at: z.iso.datetime(),
  url: z.string(),
  server: z.object({
    version: ParsedVersion.nullable(),
    edition: Edition.nullable(),
    date: z.string().nullable(),
    hash: z.string().nullable(),
    tokenFeatures: TokenFeatures.nullable(),
  }),
});
type CachedProbe = z.infer<typeof CachedProbe>;

function probeCachePath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, URL_HASH_LENGTH);
  return join(cacheDir(), `probe-${hash}.json`);
}

// A malformed or unreadable entry reads as a miss: the cache is an optimisation over a probe the
// CLI can always run again, so nothing in it is worth refusing a command over.
export async function readCachedProbe(url: string, nowMs: number): Promise<ServerInfo | null> {
  let raw: string;
  try {
    raw = await fs.readFile(probeCachePath(url), "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  const parsed = parseJsonResult(raw, CachedProbe);
  if (!parsed.ok || parsed.value.url !== url) {
    return null;
  }
  if (Date.parse(parsed.value.at) + PROBE_CACHE_TTL_MS <= nowMs) {
    return null;
  }
  return parsed.value.server;
}

export async function writeCachedProbe(
  url: string,
  server: ServerInfo,
  nowMs: number,
): Promise<void> {
  const path = probeCachePath(url);
  const entry: CachedProbe = { at: new Date(nowMs).toISOString(), url, server };
  await fs.mkdir(dirname(path), { recursive: true, mode: CACHE_DIR_MODE });
  await fs.writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, { mode: CACHE_FILE_MODE });
}

type ProbeSource = "cache" | "probe";

interface ServerLookup {
  probe: ServerInfo;
  source: ProbeSource;
}

export async function cachedServerLookup(url: string): Promise<ServerLookup | null> {
  const cached = await readCachedProbe(url, Date.now());
  return cached === null ? null : { probe: cached, source: "cache" };
}

// One probe, stored for the processes that follow.
export async function probeAndCacheServer(
  url: string,
  probe: () => Promise<ServerInfo>,
): Promise<ServerLookup> {
  const fresh = await probe();
  await writeCachedProbe(url, fresh, Date.now());
  return { probe: fresh, source: "probe" };
}
