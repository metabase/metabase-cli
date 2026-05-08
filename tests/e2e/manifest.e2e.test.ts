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
      "auth list",
      "auth logout",
      "license set",
      "license status",
      "license remove",
      "db list",
      "db get",
      "table list",
      "table get",
      "field get",
      "card list",
      "card get",
      "card query",
      "card create",
      "card update",
      "card archive",
      "dashboard list",
      "dashboard get",
      "dashboard cards",
      "dashboard create",
      "dashboard update",
      "dashboard update-dashcard",
      "collection list",
      "collection get",
      "collection items",
      "collection tree",
      "collection create",
      "transform list",
      "transform get",
      "transform create",
      "transform update",
      "transform delete",
      "transform delete-table",
      "transform run",
      "transform-job list",
      "transform-job get",
      "transform-job create",
      "transform-job update",
      "transform-job delete",
      "setting list",
      "setting get",
      "setting set",
      "search",
      "sync status",
      "sync is-dirty",
      "sync has-remote-changes",
      "sync dirty",
      "sync current-task",
      "sync cancel-task",
      "sync wait",
      "sync import",
      "sync export",
      "sync stash",
      "sync branches",
      "sync create-branch",
      "sync add-collection",
      "sync remove-collection",
      "workspace list",
      "workspace create",
      "workspace database provision",
      "workspace database update",
      "workspace database deprovision",
      "workspace start",
      "workspace stop",
      "workspace remove",
      "workspace logs",
      "workspace url",
      "workspace credentials",
      "workspace ps",
      "setup",
      "api-key create",
      "eid translate",
      "query",
    ]);

    // Streaming commands legitimately have no outputSchema — they pipe raw bytes
    // (docker logs) to stdout rather than a typed JSON envelope.
    const streamingCommands = new Set(["workspace logs"]);

    for (const entry of manifest.commands) {
      expect(entry.examples.length, `missing examples for ${entry.command}`).toBeGreaterThan(0);
      if (!streamingCommands.has(entry.command)) {
        expect(entry.outputSchema, `missing outputSchema for ${entry.command}`).not.toBeNull();
      }
    }
  });
});
