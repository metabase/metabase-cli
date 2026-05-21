import { afterEach, describe, expect, it } from "vitest";

import { writeProbeResult, writeProfile } from "../../src/core/auth/storage";
import { BASELINE_CAPABILITIES } from "../../src/core/version/capabilities";
import { Manifest } from "../../src/runtime/manifest";
import { parseJson } from "../../src/runtime/json";

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
  const prevKeyring = process.env["METABASE_CLI_DISABLE_KEYRING"];
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env["METABASE_CLI_DISABLE_KEYRING"] = "1";
  try {
    await seed();
  } finally {
    restoreEnv("XDG_CONFIG_HOME", prevXdg);
    restoreEnv("METABASE_CLI_DISABLE_KEYRING", prevKeyring);
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

const MEASURE_CAPABILITIES = { minVersion: 59 } as const;
const TRANSFORM_CAPABILITIES = { minVersion: 59 } as const;
const WORKSPACE_CAPABILITIES = {
  minVersion: 62,
  tokenFeature: "workspaces",
} as const;

describe("version preflight e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("manifest gates every measure command at v59 and keeps card commands at baseline", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    const measureCapabilities = Object.fromEntries(
      manifest.commands
        .filter((entry) => entry.command.startsWith("measure "))
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(measureCapabilities).toEqual({
      "measure list": MEASURE_CAPABILITIES,
      "measure get": MEASURE_CAPABILITIES,
      "measure create": MEASURE_CAPABILITIES,
      "measure update": MEASURE_CAPABILITIES,
      "measure archive": MEASURE_CAPABILITIES,
    });

    const cardList = manifest.commands.find((entry) => entry.command === "card list");
    expect(cardList?.capabilities).toEqual(BASELINE_CAPABILITIES);
  });

  it("manifest carries the transforms premium token-feature gate through to EE commands", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    const transformCapabilities = Object.fromEntries(
      manifest.commands
        .filter(
          (entry) =>
            entry.command.startsWith("transform ") || entry.command.startsWith("transform-job "),
        )
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(transformCapabilities).toEqual({
      "transform list": TRANSFORM_CAPABILITIES,
      "transform get": TRANSFORM_CAPABILITIES,
      "transform create": TRANSFORM_CAPABILITIES,
      "transform update": TRANSFORM_CAPABILITIES,
      "transform delete": TRANSFORM_CAPABILITIES,
      "transform run": TRANSFORM_CAPABILITIES,
      "transform runs": TRANSFORM_CAPABILITIES,
      "transform get-run": TRANSFORM_CAPABILITIES,
      "transform cancel": TRANSFORM_CAPABILITIES,
      "transform delete-table": TRANSFORM_CAPABILITIES,
      "transform-job list": TRANSFORM_CAPABILITIES,
      "transform-job get": TRANSFORM_CAPABILITIES,
      "transform-job create": TRANSFORM_CAPABILITIES,
      "transform-job update": TRANSFORM_CAPABILITIES,
      "transform-job delete": TRANSFORM_CAPABILITIES,
    });
  });

  it("manifest reports null capabilities for local commands that never touch a Metabase server", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    const localCapabilities = Object.fromEntries(
      manifest.commands
        .filter((entry) => entry.command === "uuid" || entry.command === "upgrade")
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(localCapabilities).toEqual({ uuid: null, upgrade: null });
  });

  it("manifest gates server-touching workspace commands at v62 and reports null for local-only ones", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    const workspaceCapabilities = Object.fromEntries(
      manifest.commands
        .filter((entry) => entry.command.startsWith("workspace "))
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(workspaceCapabilities).toEqual({
      "workspace list": WORKSPACE_CAPABILITIES,
      "workspace create": WORKSPACE_CAPABILITIES,
      "workspace start": WORKSPACE_CAPABILITIES,
      "workspace stop": null,
      "workspace delete": null,
      "workspace ps": null,
      "workspace logs": null,
      "workspace url": null,
      "workspace credentials": null,
      "workspace database provision": WORKSPACE_CAPABILITIES,
      "workspace database deprovision": WORKSPACE_CAPABILITIES,
      "workspace database update": WORKSPACE_CAPABILITIES,
      "workspace license set": null,
      "workspace license status": null,
      "workspace license remove": null,
    });
  });
});

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

  it("bypasses the refusal via METABASE_CLI_SKIP_PREFLIGHT=1 and reaches the network layer", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({
      args: ["measure", "list"],
      configHome,
      env: { METABASE_CLI_SKIP_PREFLIGHT: "1" },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("This command requires Metabase");
    expect(result.stderr).toContain("Could not reach Metabase");
  });
});
