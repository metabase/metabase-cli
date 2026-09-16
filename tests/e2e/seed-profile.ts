import type { ServerInfo } from "@metabase/client/version/probe";

import { writeProbeResult, writeProfile } from "../../packages/cli/src/core/auth/storage";

// The seeded records are written straight through the CLI's own storage, so the CLI under test
// reads a profile it could have written itself; the port-1 URL never answers, which keeps a test
// on the cached probe honest about opening no socket.
export const UNREACHABLE_URL = "http://127.0.0.1:1";
export const SEED_USER = { id: 1, name: "Tester", isAdmin: true };

export interface SeedTarget {
  url: string;
  apiKey: string;
}

export const UNREACHABLE: SeedTarget = { url: UNREACHABLE_URL, apiKey: "secret-key" };

export function versionAt(major: number): ServerInfo["version"] {
  return { tag: `v0.${major}.0`, major, patch: 0 };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function withSeedEnv(configHome: string, seed: () => Promise<void>): Promise<void> {
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevKeyring = process.env["MB_CLI_DISABLE_KEYRING"];
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env["MB_CLI_DISABLE_KEYRING"] = "1";
  try {
    await seed();
  } finally {
    restoreEnv("XDG_CONFIG_HOME", prevXdg);
    restoreEnv("MB_CLI_DISABLE_KEYRING", prevKeyring);
  }
}

export async function seedProfile(configHome: string): Promise<void> {
  await withSeedEnv(configHome, async () => {
    await writeProfile(UNREACHABLE, "default");
  });
}

export async function seedProbedProfileAt(
  configHome: string,
  target: SeedTarget,
  version: ServerInfo["version"],
  tokenFeatures: ServerInfo["tokenFeatures"] = null,
): Promise<void> {
  await withSeedEnv(configHome, async () => {
    await writeProfile(target, "default");
    await writeProbeResult("default", {
      user: SEED_USER,
      server: { version, date: null, hash: null, tokenFeatures },
    });
  });
}

export async function seedProbedProfile(configHome: string, major: number): Promise<void> {
  await seedProbedProfileAt(configHome, UNREACHABLE, versionAt(major));
}
