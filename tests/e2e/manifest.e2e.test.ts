import { afterEach, describe, expect, it } from "vitest";

import { Manifest } from "../../src/runtime/manifest";
import { parseJson } from "../../src/runtime/json";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("__manifest e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("dumps a parseable manifest covering every leaf command with examples and an output schema", async () => {
    const result = await runCli({
      args: ["__manifest"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const manifest = parseJson(result.stdout, Manifest, { source: "__manifest" });
    const commandPaths = manifest.commands.map((entry) => entry.command);

    expect(manifest.version).toBe(1);
    expect(commandPaths).toEqual([
      "auth login",
      "auth status",
      "auth logout",
      "license set",
      "license status",
      "license remove",
    ]);

    for (const entry of manifest.commands) {
      expect(entry.examples.length, `missing examples for ${entry.command}`).toBeGreaterThan(0);
      expect(entry.outputSchema, `missing outputSchema for ${entry.command}`).not.toBeNull();
    }
  });
});
