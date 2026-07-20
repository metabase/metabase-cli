import { afterEach, describe, expect, it } from "vitest";

import { writeProbeResult, writeProfile } from "../../src/core/auth/storage";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const UNREACHABLE_URL = "http://127.0.0.1:1";

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

async function seedProfile(configHome: string): Promise<void> {
  await withSeedEnv(configHome, async () => {
    await writeProfile({ url: UNREACHABLE_URL, apiKey: "secret-key" }, "default");
  });
}

async function seedProbedProfile(configHome: string, major: number): Promise<void> {
  await withSeedEnv(configHome, async () => {
    await writeProfile({ url: UNREACHABLE_URL, apiKey: "secret-key" }, "default");
    await writeProbeResult("default", {
      user: { id: 1, name: "Tester", isAdmin: true },
      server: {
        version: { tag: `v0.${major}.0`, major, patch: 0 },
        tokenFeatures: null,
      },
    });
  });
}

describe("version preflight enforcement e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("refuses a command whose minVersion exceeds the cached server version (exit 2)", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "This command requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase or pin mb-cli to an older release.",
    );
  });

  it("bypasses the refusal and reaches the network layer when --skip-preflight is passed", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["measure", "list", "--skip-preflight"], configHome });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("This command requires Metabase");
    expect(result.stderr).toContain("Could not reach Metabase");
  });

  it("warns but proceeds when a gated command runs without a cached probe", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProfile(configHome);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not detect Metabase server version");
    expect(result.stderr).toContain("Could not reach Metabase");
  });

  it("refuses a token-gated command when the cached server lacks the premium feature (exit 2)", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 60);

    const result = await runCli({ args: ["git-sync", "status"], configHome });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "This command requires the 'remote_sync' premium feature (not enabled on this server).",
    );
  });

  it("bypasses the refusal via MB_CLI_SKIP_PREFLIGHT=1 and reaches the network layer", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({
      args: ["measure", "list"],
      configHome,
      env: { MB_CLI_SKIP_PREFLIGHT: "1" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("This command requires Metabase");
    expect(result.stderr).toContain("Could not reach Metabase");
  });
});
