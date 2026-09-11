import { afterEach, describe, expect, it } from "vitest";

import { seedProbedProfile, seedProfile } from "./probed-profile";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

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
    await seedProbedProfile(configHome, { major: 58, tokenFeatures: null });

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
    );
  });

  it("bypasses the refusal and reaches the network layer when --skip-preflight is passed", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, { major: 58, tokenFeatures: null });

    const result = await runCli({ args: ["measure", "list", "--skip-preflight"], configHome });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("This operation requires Metabase");
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
    await seedProbedProfile(configHome, { major: 60, tokenFeatures: null });

    const result = await runCli({ args: ["git-sync", "status"], configHome });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
    );
  });

  it("bypasses the refusal via MB_CLI_SKIP_PREFLIGHT=1 and reaches the network layer", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, { major: 58, tokenFeatures: null });

    const result = await runCli({
      args: ["measure", "list"],
      configHome,
      env: { MB_CLI_SKIP_PREFLIGHT: "1" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("This operation requires Metabase");
    expect(result.stderr).toContain("Could not reach Metabase");
  });
});
