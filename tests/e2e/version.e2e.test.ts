import { afterEach, describe, expect, it } from "vitest";

import { BASELINE_CAPABILITIES } from "../../src/core/version/capabilities";
import { Manifest } from "../../src/runtime/manifest";
import { parseJson } from "../../src/runtime/json";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const MEASURE_CAPABILITIES = { minVersion: 59, edition: "oss" } as const;
const TRANSFORM_CAPABILITIES = {
  minVersion: 58,
  edition: "ee",
  tokenFeature: "transforms",
} as const;
const WORKSPACE_CAPABILITIES = {
  minVersion: 62,
  edition: "ee",
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

  it("manifest gates every workspace command at v62 behind the workspaces token-feature", async () => {
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
      "workspace stop": WORKSPACE_CAPABILITIES,
      "workspace remove": WORKSPACE_CAPABILITIES,
      "workspace ps": WORKSPACE_CAPABILITIES,
      "workspace logs": WORKSPACE_CAPABILITIES,
      "workspace url": WORKSPACE_CAPABILITIES,
      "workspace credentials": WORKSPACE_CAPABILITIES,
      "workspace database provision": WORKSPACE_CAPABILITIES,
      "workspace database deprovision": WORKSPACE_CAPABILITIES,
      "workspace database update": WORKSPACE_CAPABILITIES,
    });
  });
});
