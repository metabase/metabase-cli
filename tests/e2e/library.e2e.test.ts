import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LibraryPublishResult } from "../../src/commands/library/publish";
import { LibraryUnpublishResult } from "../../src/commands/library/unpublish";
import { Library } from "../../src/domain/library";
import { TableCompact } from "../../src/domain/table";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const LIBRARY_UNAVAILABLE = requireServer({ minVersion: 59, tokenFeature: "library" });

const REVIEWS_COMPACT = {
  id: SEEDED.tables.reviews,
  name: "reviews",
  display_name: "Reviews",
  description: null,
  db_id: SEEDED.warehouseDbId,
  schema: "public",
  entity_type: "entity/GenericTable",
  is_published: false,
};

const NO_SELECTOR_MESSAGE = "provide at least one selector: --table-ids, --db-ids, or --schemas";

describe("library e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("publish without any selector fails fast with ConfigError before any request", async () => {
    const result = await runCli({
      args: ["library", "publish", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(NO_SELECTOR_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("publish with a non-integer table id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "publish", "--table-ids", "1,abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid table id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("unpublish without any selector fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "unpublish", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(NO_SELECTOR_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("unpublish with a non-integer database id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "unpublish", "--db-ids", "x", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid database id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  describe.skipIf(LIBRARY_UNAVAILABLE !== null)("with the library feature", () => {
    it("get returns the Library with its Data collection", async () => {
      const result = await runCli({
        args: ["library", "get", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const data = parseJson(result.stdout, Library).effective_children.find(
        (child) => child.type === "library-data",
      );
      expect(data).toEqual({
        id: SEEDED.libraryDataCollectionId,
        name: "Data",
        type: "library-data",
        description: null,
      });
    });

    it("create is idempotent and returns the existing Library", async () => {
      const result = await runCli({
        args: ["library", "create", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const data = parseJson(result.stdout, Library).effective_children.find(
        (child) => child.type === "library-data",
      );
      expect(data).toEqual({
        id: SEEDED.libraryDataCollectionId,
        name: "Data",
        type: "library-data",
        description: null,
      });
    });

    it("publish resolves the Data collection and sets is_published, unpublish restores it", async () => {
      const publish = await runCli({
        args: ["library", "publish", "--table-ids", String(SEEDED.tables.reviews), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(publish.exitCode, publish.stderr).toBe(0);
      const target = parseJson(publish.stdout, LibraryPublishResult).target_collection;
      if (target === null) {
        throw new Error("expected a target_collection in the publish response");
      }
      expect({ id: target.id, name: target.name, type: target.type }).toEqual({
        id: SEEDED.libraryDataCollectionId,
        name: "Data",
        type: "library-data",
      });

      const whilePublished = await runCli({
        args: ["table", "get", String(SEEDED.tables.reviews), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(whilePublished.exitCode, whilePublished.stderr).toBe(0);
      expect(parseJson(whilePublished.stdout, TableCompact)).toEqual({
        ...REVIEWS_COMPACT,
        is_published: true,
      });

      const unpublish = await runCli({
        args: ["library", "unpublish", "--table-ids", String(SEEDED.tables.reviews), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(unpublish.exitCode, unpublish.stderr).toBe(0);
      expect(parseJson(unpublish.stdout, LibraryUnpublishResult)).toEqual({
        unpublished: true,
        table_ids: [SEEDED.tables.reviews],
      });

      const afterUnpublish = await runCli({
        args: ["table", "get", String(SEEDED.tables.reviews), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(afterUnpublish.exitCode, afterUnpublish.stderr).toBe(0);
      expect(parseJson(afterUnpublish.stdout, TableCompact)).toEqual(REVIEWS_COMPACT);
    });
  });
});
