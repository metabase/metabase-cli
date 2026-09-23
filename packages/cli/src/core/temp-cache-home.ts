import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerInfo } from "@metabase/client/version/probe";
import { editionFromTag } from "@metabase/client/version/tag";

import { writeCachedProbe } from "./server-cache";

// Port 1 is on fetch's blocked-port list, so a test reading the cached probe cannot be quietly
// served by a live server, and the failure carries no syscall code to hint from.
export const UNREACHABLE_URL = "http://127.0.0.1:1";

// The credential a test hands the CLI for the unreachable server.
export const UNREACHABLE_ENV = { MB_URL: UNREACHABLE_URL, MB_API_KEY: "secret-key" } as const;

export interface TempCacheHome {
  path: string;
  cleanup(): void;
}

// Points the probe cache at a fresh directory, so a test reads only what it seeded.
export function setupTempCacheHome(): TempCacheHome {
  const originalEnv = { ...process.env };
  const path = mkdtempSync(join(tmpdir(), "mb-rde-cache-"));
  process.env["XDG_CACHE_HOME"] = path;
  delete process.env["LOCALAPPDATA"];
  return {
    path,
    cleanup() {
      process.env = { ...originalEnv };
      rmSync(path, { recursive: true, force: true });
    },
  };
}

// A probe as a previous process would have left it, fresh enough to be read back.
export async function seedCachedProbe(server: ServerInfo, url = UNREACHABLE_URL): Promise<void> {
  await writeCachedProbe(url, server, Date.now());
}

// A released server at `major`, as `probeServer` would report it: the edition is what the tag stamps.
export function probeAt(
  major: number,
  tokenFeatures: ServerInfo["tokenFeatures"] = null,
): ServerInfo {
  const tag = `v0.${major}.0`;
  return {
    edition: editionFromTag(tag),
    version: { tag, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  };
}
