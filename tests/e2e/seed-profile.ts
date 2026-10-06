import type { ServerInfo } from "@metabase/client/version/probe";

import { writeProfile } from "../../packages/cli/src/core/auth/storage";
import {
  probeAt,
  type SeedTarget,
  seedProbedProfile as writeProbedProfile,
  UNREACHABLE_TARGET,
} from "../../packages/cli/src/core/auth/temp-config-home";

const SEED_PROFILE_NAME = "default";

// What a command sent to the seeded profile's server reports: nothing listens there, so an answer
// of this kind proves the request left rather than being refused on the cached probe's word.
export const UNREACHABLE_SEED_MESSAGE = "Could not reach Metabase: fetch failed";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// The CLI's own storage writes the seeded records, so the binary under test reads a profile it
// could have written itself; the storage reads its config home and keyring switch off the
// environment, which is pointed at the test's config home for the write alone.
async function withSeedEnv<T>(configHome: string, seed: () => Promise<T>): Promise<T> {
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevKeyring = process.env["MB_CLI_DISABLE_KEYRING"];
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env["MB_CLI_DISABLE_KEYRING"] = "1";
  try {
    return await seed();
  } finally {
    restoreEnv("XDG_CONFIG_HOME", prevXdg);
    restoreEnv("MB_CLI_DISABLE_KEYRING", prevKeyring);
  }
}

export async function seedProfile(configHome: string): Promise<void> {
  await withSeedEnv(configHome, async () => {
    await writeProfile(UNREACHABLE_TARGET, SEED_PROFILE_NAME);
  });
}

export async function seedProbedProfileAt(
  configHome: string,
  target: SeedTarget,
  server: ServerInfo,
): Promise<string> {
  return withSeedEnv(configHome, async () => writeProbedProfile(SEED_PROFILE_NAME, server, target));
}

export async function seedProbedProfile(configHome: string, major: number): Promise<string> {
  return seedProbedProfileAt(configHome, UNREACHABLE_TARGET, probeAt(major));
}
