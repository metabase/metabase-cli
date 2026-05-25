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
      "db list",
      "db get",
      "db metadata",
      "db schemas",
      "db schema-tables",
      "db sync-schema",
      "db rescan-values",
      "table list",
      "table get",
      "table metadata",
      "table fields",
      "table update",
      "field get",
      "field values",
      "field summary",
      "field update",
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
      "dashboard archive",
      "collection list",
      "collection get",
      "collection items",
      "collection tree",
      "collection create",
      "collection archive",
      "transform list",
      "transform get",
      "transform create",
      "transform update",
      "transform delete",
      "transform delete-table",
      "transform run",
      "transform cancel",
      "transform get-run",
      "transform runs",
      "transform-job list",
      "transform-job get",
      "transform-job create",
      "transform-job update",
      "transform-job delete",
      "setting list",
      "setting get",
      "setting set",
      "search",
      "git-sync status",
      "git-sync is-dirty",
      "git-sync has-remote-changes",
      "git-sync dirty",
      "git-sync current-task",
      "git-sync cancel-task",
      "git-sync wait",
      "git-sync import",
      "git-sync export",
      "git-sync stash",
      "git-sync branches",
      "git-sync create-branch",
      "git-sync add-collection",
      "git-sync remove-collection",
      "setup",
      "snippet list",
      "snippet get",
      "snippet create",
      "snippet update",
      "snippet archive",
      "segment list",
      "segment get",
      "segment create",
      "segment update",
      "segment archive",
      "measure list",
      "measure get",
      "measure create",
      "measure update",
      "measure archive",
      "eid",
      "query",
      "uuid",
      "upgrade",
      "skills list",
      "skills get",
      "skills path",
    ]);

    for (const entry of manifest.commands) {
      expect(entry.examples.length, `missing examples for ${entry.command}`).toBeGreaterThan(0);
      expect(entry.outputSchema, `missing outputSchema for ${entry.command}`).not.toBeNull();
    }
  });
});
