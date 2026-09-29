import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Card, CardCompact, type CardCreateInput } from "@metabase/client/domain/card";
import { SEARCH_MODELS, SearchResult } from "@metabase/client/domain/search";
import { parseJson } from "@metabase/client/json";
import { pollUntil } from "@metabase/client/poll";

import { SearchListEnvelope } from "../../packages/cli/src/commands/search";
import { listEnvelopeSchema } from "../../packages/cli/src/output/types";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

const ORDERS_BY_STATUS_COMPACT = {
  id: SEEDED.ordersCardId,
  name: "Orders by status",
  model: "card",
  description: null,
} as const;

const ORDERS_OVERVIEW_COMPACT = {
  id: SEEDED.ordersDashboardId,
  name: "Orders Overview",
  model: "dashboard",
  description: "E2E seeded dashboard with one orders dashcard.",
} as const;

const DEFAULT_COLLECTION_COMPACT = {
  id: SEEDED.defaultCollectionId,
  name: "E2E Default",
  model: "collection",
  description: null,
} as const;

// A term no seeded name, description or query text carries, so only the native query text of the
// card created below can match it.
const NATIVE_NEEDLE = "zebrafish";
const NATIVE_PROBE_CARD_NAME = "e2e_search_native_probe";
const NATIVE_PROBE_CARD_BODY: CardCreateInput = {
  name: NATIVE_PROBE_CARD_NAME,
  display: "table",
  visualization_settings: {},
  collection_id: SEEDED.defaultCollectionId,
  dataset_query: {
    type: "native",
    database: SEEDED.warehouseDbId,
    native: { query: `SELECT '${NATIVE_NEEDLE}' AS needle` },
  },
};

const SearchFullListEnvelope = listEnvelopeSchema(SearchResult);
const ResultColumnName = z.object({ name: z.string() }).loose();

function columnNames(row: SearchResult): string[] | null | undefined {
  if (row.result_metadata === undefined || row.result_metadata === null) {
    return row.result_metadata;
  }
  return z
    .array(ResultColumnName)
    .parse(row.result_metadata)
    .map((column) => column.name);
}

const UNKNOWN_USER_ID = 999999;
const SEARCH_INDEX_POLL = { intervalMs: 200, timeoutMs: 15_000 } as const;

describe("search e2e", () => {
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

  it("search with a query finds the seeded card and emits compact rows by default", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "Orders by status", "--limit", "10", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SearchListEnvelope)).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      limit: 10,
    });
  });

  it("--models card narrows the result to the cards-only set", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--models", "card", "--limit", "20", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SearchListEnvelope)).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      limit: 20,
    });
  });

  it("--models with an unknown value rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--models", "card,nope", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `invalid --models value: nope (expected one of: ${SEARCH_MODELS.join(", ")})`,
    );
    expect(result.stdout).toBe("");
  });

  it("--collection answers the collection itself and its items, and only the collection when it is empty", async () => {
    const configHome = await makeIsolatedConfigHome();
    const seeded = await runCli({
      args: ["search", "--collection", String(SEEDED.defaultCollectionId), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(seeded.exitCode, seeded.stderr).toBe(0);
    const envelope = parseJson(seeded.stdout, SearchListEnvelope);
    expect({
      ...envelope,
      data: envelope.data.toSorted((a, b) => a.model.localeCompare(b.model)),
    }).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT, DEFAULT_COLLECTION_COMPACT, ORDERS_OVERVIEW_COMPACT],
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
      limit: 20,
    });

    const personal = await runCli({
      args: ["search", "--collection", String(SEEDED.adminPersonalCollectionId), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(personal.exitCode, personal.stderr).toBe(0);
    expect(parseJson(personal.stdout, SearchListEnvelope)).toEqual({
      data: [
        {
          id: SEEDED.adminPersonalCollectionId,
          name: "Admin E2E's Personal Collection",
          model: "collection",
          description: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      limit: 20,
    });
  });

  it("--created-by keeps the cards created by any listed user and drops the rest", async () => {
    const configHome = await makeIsolatedConfigHome();
    const card = await runCli({
      args: ["card", "get", String(SEEDED.ordersCardId), "--full", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(card.exitCode, card.stderr).toBe(0);
    const creatorId = parseJson(card.stdout, Card).creator_id;

    const byCreator = await runCli({
      args: [
        "search",
        "--models",
        "card",
        "--created-by",
        `${creatorId},${UNKNOWN_USER_ID}`,
        "--json",
      ],
      configHome,
      env: authEnv(),
    });

    expect(byCreator.exitCode, byCreator.stderr).toBe(0);
    expect(parseJson(byCreator.stdout, SearchListEnvelope)).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      limit: 20,
    });

    const byNobody = await runCli({
      args: ["search", "--models", "card", "--created-by", String(UNKNOWN_USER_ID), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(byNobody.exitCode, byNobody.stderr).toBe(0);
    expect(parseJson(byNobody.stdout, SearchListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
      limit: 20,
    });
  });

  it("--created-by with an empty part rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--created-by", "1,,2", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid --created-by: "" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("--search-native-query matches a term that only a native query's text carries", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify(NATIVE_PROBE_CARD_BODY),
      configHome,
      env: authEnv(),
    });
    expect(created.exitCode, created.stderr).toBe(0);
    const probeCardId = parseJson(created.stdout, CardCompact).id;

    // The search index is fed asynchronously, so the probe card is findable only once it drains.
    const byQueryText = await pollUntil(
      async () => {
        const result = await runCli({
          args: ["search", NATIVE_NEEDLE, "--search-native-query", "--json"],
          configHome,
          env: authEnv(),
        });
        expect(result.exitCode, result.stderr).toBe(0);
        return parseJson(result.stdout, SearchListEnvelope);
      },
      (envelope) => envelope.returned > 0,
      SEARCH_INDEX_POLL,
    );

    expect(byQueryText).toEqual({
      data: [
        {
          id: probeCardId,
          name: NATIVE_PROBE_CARD_NAME,
          model: "card",
          description: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      limit: 20,
    });

    const byName = await runCli({
      args: ["search", NATIVE_NEEDLE, "--json"],
      configHome,
      env: authEnv(),
    });

    expect(byName.exitCode, byName.stderr).toBe(0);
    expect(parseJson(byName.stdout, SearchListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
      limit: 20,
    });
  });

  it("--include-metadata attaches the card's result columns to its full row", async () => {
    const configHome = await makeIsolatedConfigHome();
    const full = await runCli({
      args: [
        "search",
        "--collection",
        String(SEEDED.defaultCollectionId),
        "--include-metadata",
        "--full",
        "--json",
      ],
      configHome,
      env: authEnv(),
    });

    expect(full.exitCode, full.stderr).toBe(0);
    const rows = parseJson(full.stdout, SearchFullListEnvelope).data;
    expect(
      rows
        .map((row) => ({ id: row.id, model: row.model, columns: columnNames(row) }))
        .toSorted((a, b) => a.model.localeCompare(b.model)),
    ).toEqual([
      { id: SEEDED.ordersCardId, model: "card", columns: ["status", "n"] },
      { id: SEEDED.defaultCollectionId, model: "collection", columns: undefined },
      { id: SEEDED.ordersDashboardId, model: "dashboard", columns: undefined },
    ]);
  });

  it("--limit with a non-positive integer rejects with a ConfigError envelope", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--limit", "0", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("invalid --limit: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("--db-id with a non-integer rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--db-id", "abc", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid --db-id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
