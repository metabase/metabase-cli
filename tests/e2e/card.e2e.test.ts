import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CardListEnvelope } from "../../src/commands/card/list";
import { Card, CardCompact, CardQueryResult } from "../../src/domain/card";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_CARDS, E2E_COLLECTIONS, E2E_DATABASES } from "./seed/ids";

const RUN_NONCE = `${Date.now()}_${process.pid}`;

const ORDERS_BY_STATUS_COMPACT = {
  id: E2E_CARDS.ORDERS_BY_STATUS,
  name: "Orders by status",
  type: "question",
  display: "table",
  archived: false,
  database_id: E2E_DATABASES.WAREHOUSE,
  collection_id: E2E_COLLECTIONS.DEFAULT,
  description: null,
} as const;

interface NativeQueryBody {
  type: "native";
  database: number;
  native: { query: string };
}

interface CardCreateBody {
  name: string;
  display: "table";
  visualization_settings: Record<string, unknown>;
  collection_id: number;
  dataset_query: NativeQueryBody;
}

function makeCardBody(slug: string, query: string): CardCreateBody {
  return {
    name: `e2e_card_${slug}_${RUN_NONCE}`,
    display: "table",
    visualization_settings: {},
    collection_id: E2E_COLLECTIONS.DEFAULT,
    dataset_query: {
      type: "native",
      database: E2E_DATABASES.WAREHOUSE,
      native: { query },
    },
  };
}

describe("card e2e", () => {
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createCard(slug: string, query: string): Promise<CardCompact> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify(makeCardBody(slug, query)),
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, CardCompact);
  }

  async function archiveCard(id: number): Promise<void> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "archive", String(id), "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns the seeded Orders-by-status card in compact form", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "list", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CardListEnvelope);
    expect(envelope.data).toContainEqual(ORDERS_BY_STATUS_COMPACT);
    expect(envelope.data.filter((row) => row.archived)).toEqual([]);
  });

  it("list --filter archived returns an archived card and excludes the active one", async () => {
    const created = await createCard("listarc", "SELECT 1 AS x");
    let archived = false;
    try {
      await archiveCard(created.id);
      archived = true;

      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["card", "list", "--filter", "archived", "--json"],
        configHome,
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const envelope = parseJson(result.stdout, CardListEnvelope);
      expect(envelope.data).toContainEqual({
        id: created.id,
        name: created.name,
        type: "question",
        display: "table",
        archived: true,
        database_id: E2E_DATABASES.WAREHOUSE,
        collection_id: E2E_COLLECTIONS.DEFAULT,
        description: null,
      });
      expect(envelope.data.find((row) => row.id === E2E_CARDS.ORDERS_BY_STATUS)).toBeUndefined();
    } finally {
      if (!archived) {
        await archiveCard(created.id);
      }
    }
  });

  it("get returns the seeded card by id in compact form", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "get", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact)).toEqual(ORDERS_BY_STATUS_COMPACT);
  });

  it("get --full returns the full card with dataset_query and query_type", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "get", String(E2E_CARDS.ORDERS_BY_STATUS), "--json", "--full"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const card = parseJson(result.stdout, Card);
    expect({
      id: card.id,
      query_type: card.query_type,
      creator_id: card.creator_id,
      table_id: card.table_id,
      dashboard_id: card.dashboard_id,
    }).toEqual({
      id: E2E_CARDS.ORDERS_BY_STATUS,
      query_type: "native",
      creator_id: 2,
      table_id: null,
      dashboard_id: null,
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "get", "abc", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing card id surfaces a 404 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("query (json) executes the card and returns the full result envelope", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, CardQueryResult);
    if (parsed.status !== "completed") {
      throw new Error(`expected status "completed", got "${parsed.status}"`);
    }
    expect({
      status: parsed.status,
      row_count: parsed.row_count,
      rowsLength: parsed.data.rows.length,
      colNames: parsed.data.cols.map((column) => column.name),
    }).toEqual({
      status: "completed",
      row_count: 5,
      rowsLength: 5,
      colNames: ["status", "n"],
    });
  });

  it("query --limit truncates the rows kept in the JSON envelope", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--json", "--limit", "2"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, CardQueryResult);
    if (parsed.status !== "completed") {
      throw new Error(`expected status "completed", got "${parsed.status}"`);
    }
    expect({
      rowsLength: parsed.data.rows.length,
      rowCountIsFullSize: parsed.row_count > 2,
    }).toEqual({
      rowsLength: 2,
      rowCountIsFullSize: true,
    });
  });

  it("query --export-format csv streams a CSV with the expected header and rows", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "csv"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("status,n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("query --export-format xlsx streams an XLSX file (zip magic bytes)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "xlsx"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.slice(0, 4)).toBe("\x50\x4b\x03\x04");
  });

  it("query --export-format with an invalid value fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "html"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --export-format: "html" (expected: csv, xlsx)');
    expect(result.stdout).toBe("");
  });

  it("query --parameters with malformed JSON fails fast with a parse error", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: [
        "card",
        "query",
        String(E2E_CARDS.ORDERS_BY_STATUS),
        "--parameters",
        "not-json",
        "--json",
      ],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--parameters: invalid JSON");
    expect(result.stdout).toBe("");
  });

  it("create + archive round-trip flips archived from false to true", async () => {
    const configHome = await makeIsolatedConfigHome();
    const createResult = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify(makeCardBody("crarc", "SELECT 2 AS x")),
      configHome,
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, CardCompact);
    expect(created).toEqual({
      id: expect.any(Number),
      name: `e2e_card_crarc_${RUN_NONCE}`,
      type: "question",
      display: "table",
      archived: false,
      database_id: E2E_DATABASES.WAREHOUSE,
      collection_id: E2E_COLLECTIONS.DEFAULT,
      description: null,
    });

    let archived = false;
    try {
      const archiveHome = await makeIsolatedConfigHome();
      const archiveResult = await runCli({
        args: ["card", "archive", String(created.id), "--json"],
        configHome: archiveHome,
        env: authEnv(),
      });
      expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
      expect(parseJson(archiveResult.stdout, CardCompact)).toEqual({
        id: created.id,
        name: created.name,
        type: "question",
        display: "table",
        archived: true,
        database_id: E2E_DATABASES.WAREHOUSE,
        collection_id: E2E_COLLECTIONS.DEFAULT,
        description: null,
      });
      archived = true;
    } finally {
      if (!archived) {
        await archiveCard(created.id);
      }
    }
  });

  it("create with a body missing required fields fails on Zod validation", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-required" }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("archive with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["card", "archive", "abc", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
