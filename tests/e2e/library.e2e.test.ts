import { beforeAll, describe, expect, it } from "vitest";

import { Library, type LibraryChild } from "@metabase/client/domain/library";
import { TableCompact } from "@metabase/client/domain/table";
import { parseJson } from "@metabase/client/json";

import { LibraryPublishResult } from "../../packages/cli/src/commands/library/publish";
import { LibraryUnpublishResult } from "../../packages/cli/src/commands/library/unpublish";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const LIBRARY_UNAVAILABLE = requireServer("library › with the library feature", ["library"]);

const SYNC_SCOPE_HINT_MARKER = "is not marked for remote sync";

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

// The Library's children arrive as a set, so they are compared in name order; only the Data
// collection's id is seeded.
function childrenByName(library: Library): LibraryChild[] {
  return library.effective_children.toSorted((a, b) => a.name.localeCompare(b.name));
}

const LIBRARY_CHILDREN = [
  {
    id: SEEDED.libraryDataCollectionId,
    name: "Data",
    description: null,
    type: "library-data",
    is_remote_synced: false,
  },
  {
    id: expect.any(Number),
    name: "Metrics",
    description: null,
    type: "library-metrics",
    is_remote_synced: false,
  },
];

describe("library e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("publish without any selector fails fast with ConfigError before any request", async () => {
    const result = await runCli({
      args: ["library", "publish", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(NO_SELECTOR_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("publish with a non-integer table id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "publish", "--table-ids", "1,abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid table id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("unpublish without any selector fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "unpublish", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(NO_SELECTOR_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("unpublish with a non-integer database id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["library", "unpublish", "--db-ids", "x", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid database id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  describe.skipIf(LIBRARY_UNAVAILABLE !== null)("with the library feature", () => {
    it("get returns the Library with its Data collection", async () => {
      const result = await runCli({
        args: ["library", "get", "--json"],
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(childrenByName(parseJson(result.stdout, Library))).toEqual(LIBRARY_CHILDREN);
    });

    it("publish resolves the Data collection and sets is_published, unpublish restores it", async () => {
      const publish = await runCli({
        args: ["library", "publish", "--table-ids", String(SEEDED.tables.reviews), "--json"],
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
        env: authEnv(),
      });
      expect(whilePublished.exitCode, whilePublished.stderr).toBe(0);
      expect(parseJson(whilePublished.stdout, TableCompact)).toEqual({
        ...REVIEWS_COMPACT,
        is_published: true,
      });

      const unpublish = await runCli({
        args: ["library", "unpublish", "--table-ids", String(SEEDED.tables.reviews), "--json"],
        env: authEnv(),
      });

      expect(unpublish.exitCode, unpublish.stderr).toBe(0);
      expect(parseJson(unpublish.stdout, LibraryUnpublishResult)).toEqual({
        unpublished: true,
        table_ids: [SEEDED.tables.reviews],
      });

      const afterUnpublish = await runCli({
        args: ["table", "get", String(SEEDED.tables.reviews), "--json"],
        env: authEnv(),
      });
      expect(afterUnpublish.exitCode, afterUnpublish.stderr).toBe(0);
      expect(parseJson(afterUnpublish.stdout, TableCompact)).toEqual(REVIEWS_COMPACT);
    });

    it("publish stays silent about git-sync scope when no remote sync url is configured", async () => {
      const publish = await runCli({
        args: ["library", "publish", "--table-ids", String(SEEDED.tables.reviews), "--json"],
        env: authEnv(),
      });

      expect(publish.exitCode, publish.stderr).toBe(0);
      expect(publish.stderr).not.toContain(SYNC_SCOPE_HINT_MARKER);
    });
  });
});
