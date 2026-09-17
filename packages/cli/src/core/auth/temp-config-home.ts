import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServerInfo } from "@metabase/client/version/probe";

import type { ProbedUser } from "./profile-record";
import { writeProbeResult, writeProfile } from "./storage";

const UNREACHABLE_URL = "http://127.0.0.1:1";
const SEED_USER: ProbedUser = { id: 1, name: "Tester", isAdmin: true };

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

// A profile record as `auth login` would have left it: the key stored, the server probed. The URL
// never answers, so a test reading the cached probe cannot be quietly served by a live server.
export async function seedProbedProfile(
  name: string,
  server: ServerInfo,
  user: ProbedUser = SEED_USER,
): Promise<void> {
  await writeProfile({ url: UNREACHABLE_URL, apiKey: "secret-key" }, name);
  await writeProbeResult(name, { user, server });
}

// A released OSS server at `major`, as `probeServer` would report it.
export function probeAt(
  major: number,
  tokenFeatures: ServerInfo["tokenFeatures"] = null,
): ServerInfo {
  return {
    edition: "oss",
    version: { tag: `v0.${major}.0`, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  };
}
