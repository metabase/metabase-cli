import { afterEach, describe, expect, it } from "vitest";

import { BASELINE_CAPABILITIES } from "../../src/core/version/capabilities";
import { Manifest } from "../../src/runtime/manifest";
import { parseJson } from "../../src/runtime/json";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

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

  it("emits capabilities for every leaf command in the manifest (baseline until per-command tasks land)", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    for (const entry of manifest.commands) {
      expect(entry.capabilities, `missing capabilities for ${entry.command}`).toEqual(
        BASELINE_CAPABILITIES,
      );
    }
  });
});
