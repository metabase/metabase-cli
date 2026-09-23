import { promises as fs } from "node:fs";

import { normalizeUrl } from "@metabase/client/url";
import type { ServerInfo } from "@metabase/client/version/probe";

import { readCachedProbe, writeCachedProbe } from "../../packages/cli/src/core/server-cache";
import { probeAt } from "../../packages/cli/src/core/temp-cache-home";

import type { ServerIdentity } from "./bootstrap-data";
import { CACHE_HOME } from "./run-cli";

// Port 1 is on fetch's blocked-port list, so a command reading a seeded probe cannot be quietly
// served by a live server, and the failure carries no syscall code to hint from.
export const UNREACHABLE_URL = "http://127.0.0.1:1";
export const UNREACHABLE_ENV = { MB_URL: UNREACHABLE_URL, MB_API_KEY: "unreachable-server-key" };

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// The CLI's own cache module writes and reads the entries, so the binary under test sees a probe
// it could have taken itself; the module locates its directory off the environment, which is
// pointed at the test file's cache home for the call alone.
async function withCacheEnv<T>(action: () => Promise<T>): Promise<T> {
  const previous = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = CACHE_HOME;
  try {
    return await action();
  } finally {
    restoreEnv("XDG_CACHE_HOME", previous);
  }
}

// The entry is keyed by the URL the CLI resolves from `MB_URL`, which is the normalized form.
export async function seedCachedProbeAt(url: string, server: ServerInfo): Promise<void> {
  await withCacheEnv(() => writeCachedProbe(normalizeUrl(url), server, Date.now()));
}

export async function seedCachedProbe(url: string, major: number): Promise<void> {
  await seedCachedProbeAt(url, probeAt(major));
}

// The bootstrap's server block is the live server's own probe plus what the harness learned about
// it, so the probe part is what the CLI would have cached itself.
export function bootstrapServerInfo(server: ServerIdentity): ServerInfo {
  return {
    version: server.version,
    edition: server.edition,
    date: server.date,
    hash: server.hash,
    tokenFeatures: server.tokenFeatures,
  };
}

export async function readSeededProbe(url: string): Promise<ServerInfo | null> {
  return withCacheEnv(() => readCachedProbe(normalizeUrl(url), Date.now()));
}

// The cache home is shared by every test in a file, so a test that must see no probe at all
// empties it first.
export async function clearCachedProbes(): Promise<void> {
  await fs.rm(CACHE_HOME, { recursive: true, force: true });
}
