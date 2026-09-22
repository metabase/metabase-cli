import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerInfo } from "@metabase/client/version/probe";
import { editionFromTag } from "@metabase/client/version/tag";

import type { ProbedUser } from "./profile-record";
import { writeProbeResult, writeProfile } from "./storage";

// Port 1 is on fetch's blocked-port list, so a test reading the cached probe cannot be quietly
// served by a live server, and the failure carries no syscall code to hint from.
export const UNREACHABLE_URL = "http://127.0.0.1:1";
export const SEED_USER: ProbedUser = { id: 1, name: "Tester", isAdmin: true };

export interface SeedTarget {
  url: string;
  apiKey: string;
}

export const UNREACHABLE_TARGET: SeedTarget = { url: UNREACHABLE_URL, apiKey: "secret-key" };

export interface TempConfigHome {
  path: string;
  cleanup(): void;
}

export function setupTempConfigHome(): TempConfigHome {
  const originalEnv = { ...process.env };
  const path = mkdtempSync(join(tmpdir(), "mb-cli-"));
  process.env["XDG_CONFIG_HOME"] = path;
  delete process.env["APPDATA"];
  return {
    path,
    cleanup() {
      process.env = { ...originalEnv };
      rmSync(path, { recursive: true, force: true });
    },
  };
}

// A profile record as `auth login` would have left it: the key stored, the server probed.
export async function seedProbedProfile(
  name: string,
  server: ServerInfo,
  target: SeedTarget = UNREACHABLE_TARGET,
): Promise<void> {
  await writeProfile(target, name);
  await writeProbeResult(name, { user: SEED_USER, server });
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

// A server whose tag parses to nothing, as `probeServer` reports a head or local build.
export const UNPARSEABLE_PROBE: ServerInfo = {
  edition: null,
  version: null,
  date: null,
  hash: null,
  tokenFeatures: null,
};
