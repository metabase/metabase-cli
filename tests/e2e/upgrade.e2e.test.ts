import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import packageJson from "../../packages/cli/package.json" with { type: "json" };
import { UpgradeStatus } from "../../packages/cli/src/commands/upgrade";
import { type RegistryFixture, startRegistryFixture } from "./registry-fixture";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("upgrade e2e", () => {
  let fixture: RegistryFixture;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    fixture = await startRegistryFixture({ latest: packageJson.version });
  });

  afterAll(async () => {
    await fixture.close();
  });

  afterEach(async () => {
    fixture.reset();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("--check --json reports up-to-date when the registry matches the bundled version", async () => {
    fixture.setDistTags({ latest: packageJson.version });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: packageJson.version,
      targetVersion: packageJson.version,
      updateAvailable: false,
      changeRequired: false,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--check --json reports updateAvailable=true when the registry advertises a newer version", async () => {
    fixture.setDistTags({ latest: "999.0.0" });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: "999.0.0",
      targetVersion: "999.0.0",
      updateAvailable: true,
      changeRequired: true,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--to <older> --check reports changeRequired but updateAvailable=false", async () => {
    fixture.setDistTags({ latest: packageJson.version });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url, "--to", "0.0.1"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: packageJson.version,
      targetVersion: "0.0.1",
      updateAvailable: false,
      changeRequired: true,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--to <invalid> exits 2 with the ZodError message", async () => {
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url, "--to", "not-a-version"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("expected semver MAJOR.MINOR.PATCH[-prerelease][+build]");
    expect(result.stdout).toBe("");
  });

  it("registry HTTP 500 surfaces as exit 1 with the registry's answer", async () => {
    fixture.setStatus(500, JSON.stringify({ error: "registry exploded" }));
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("registry exploded");
  });

  it("default (text, TTY off) renders prose and includes the latest version", async () => {
    fixture.setDistTags({ latest: "999.0.0" });
    const result = await runCli({
      args: ["upgrade", "--check", "--format", "text", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Update available: ${packageJson.version} → 999.0.0`);
    expect(result.stdout).toContain("Running from source");
  });
});
