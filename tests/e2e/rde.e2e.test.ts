import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { EntityIdList } from "../../packages/cli/src/commands/entity-id";
import { SearchListEnvelope } from "../../packages/cli/src/commands/search";
import { TreeValidationReport } from "../../packages/cli/src/commands/validate";
import { startBrokerFixture, type BrokerFixture } from "../../packages/cli/src/core/broker-fixture";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";

// The representation repository's own examples: every file validates, so a repository the app
// creates from them validates too.
const REFERENCE_EXAMPLES = resolve(
  fileURLToPath(import.meta.url),
  "../../../packages/cli/src/core/schema/examples",
);
const REFERENCE_EXAMPLE_COUNT = 97;

// The error names the first token the command tree does not know: the group when the whole
// family is gone, the verb when only it is.
const REMOVED_COMMANDS = [
  { command: "card create", unknown: "create" },
  { command: "auth login", unknown: "auth" },
  { command: "setting list", unknown: "setting" },
  { command: "upgrade", unknown: "upgrade" },
  { command: "git-sync export", unknown: "export" },
  { command: "dashboard update-dashcard", unknown: "update-dashcard" },
  { command: "transform delete", unknown: "delete" },
  { command: "upload csv", unknown: "upload" },
];

const SESSION_TOKEN = "e2e-session-token";

function exampleFiles(): number {
  return readdirSync(REFERENCE_EXAMPLES, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".yaml"),
  ).length;
}

describe("rde e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "mb-rde-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  describe("validate", () => {
    it("passes every reference example and reports each file", async () => {
      const result = await runCli({ args: ["validate", REFERENCE_EXAMPLES, "--json"] });

      expect(result.exitCode, result.stderr).toBe(0);
      const report = parseJson(result.stdout, TreeValidationReport);
      expect(exampleFiles()).toBe(REFERENCE_EXAMPLE_COUNT);
      expect({
        ok: report.ok,
        checked: report.checked,
        passed: report.passed,
        failed: report.failed,
      }).toEqual({
        ok: true,
        checked: REFERENCE_EXAMPLE_COUNT,
        passed: REFERENCE_EXAMPLE_COUNT,
        failed: 0,
      });
      expect(report.results.filter((entry) => !entry.ok)).toEqual([]);
    });

    it("fails a broken file with the JSON pointer and exits 1, still printing the report", async () => {
      const file = join(tempDir(), "broken.yaml");
      writeBroken(file);

      const result = await runCli({ args: ["validate", file, "--json"] });

      expect(result.exitCode).toBe(1);
      expect(parseJson(result.stdout, TreeValidationReport)).toEqual({
        ok: false,
        checked: 1,
        passed: 0,
        failed: 1,
        results: [
          {
            file,
            model: "Collection",
            ok: false,
            errors: [{ path: "/entity_id", message: 'must match pattern "^[A-Za-z0-9_-]{21}$"' }],
          },
        ],
      });
      expect(cliErrorMessage(result.stderr)).toBe(
        "1 of 1 file(s) failed validation; validation is structural: a file that passes can still name a table, card or collection the instance does not have, or a query it cannot run",
      );
    });

    it("exits 2 for a path that does not exist", async () => {
      const missing = join(tempDir(), "nope.yaml");

      const result = await runCli({ args: ["validate", missing, "--json"] });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(`${missing} does not exist`);
    });
  });

  describe("entity-id", () => {
    it("mints 21-character NanoIDs, distinct, as a JSON array", async () => {
      const result = await runCli({ args: ["entity-id", "--count", "3", "--json"] });

      expect(result.exitCode, result.stderr).toBe(0);
      const ids = parseJson(result.stdout, EntityIdList);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe("removed commands", () => {
    it.each(REMOVED_COMMANDS)("$command exits 2 as an unknown command", async (removed) => {
      const result = await runCli({ args: removed.command.split(" ") });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toContain(`unknown command: ${removed.unknown};`);
      expect(result.stdout).toBe("");
    });
  });

  describe("the app's token broker", () => {
    let broker: BrokerFixture | null = null;

    afterEach(async () => {
      if (broker !== null) {
        await broker.close();
        broker = null;
      }
    });

    async function brokerEnv(answers: BrokerFixture["answers"]): Promise<Record<string, string>> {
      broker = await startBrokerFixture(answers);
      return {
        MB_URL: bootstrap.baseUrl,
        MB_AUTH_BROKER: broker.url,
        MB_AUTH_BROKER_TOKEN: SESSION_TOKEN,
      };
    }

    it("runs a command with the broker's credential and no MB_API_KEY in the environment", async () => {
      const env = await brokerEnv([
        {
          status: 200,
          body: {
            url: bootstrap.baseUrl,
            credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey },
            worktreeId: null,
          },
        },
      ]);

      const result = await runCli({ args: ["search", "--json", "--limit", "1"], env });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, SearchListEnvelope).returned).toBe(1);
      expect(broker?.requests).toEqual([
        { method: "GET", path: "/v1/credential", authorization: `Bearer ${SESSION_TOKEN}` },
      ]);
    });

    it("exits 2 with the broker's reason when the app has no credential", async () => {
      const env = await brokerEnv([{ status: 503, body: { reason: "signed out" } }]);

      const result = await runCli({ args: ["search", "--json", "--limit", "1"], env });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(
        "Metabase RDE has no credential for this session: signed out",
      );
    });

    it("exits 2 naming both urls when MB_URL is not the server the broker serves", async () => {
      const env = await brokerEnv([
        {
          status: 200,
          body: {
            url: "https://other.example.com",
            credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey },
            worktreeId: null,
          },
        },
      ]);

      const result = await runCli({ args: ["search", "--json", "--limit", "1"], env });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(
        `MB_URL is ${bootstrap.baseUrl} but the MB_AUTH_BROKER credential is for https://other.example.com`,
      );
    });
  });
});

function writeBroken(file: string): void {
  writeFileSync(
    file,
    [
      "name: Broken",
      "entity_id: short",
      "serdes/meta:",
      "  - id: short",
      "    model: Collection",
      "",
    ].join("\n"),
  );
}
