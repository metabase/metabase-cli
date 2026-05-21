import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DashcardListEnvelope } from "../../src/commands/dashboard/cards";
import { DashboardListEnvelope } from "../../src/commands/dashboard/list";
import { ValidationOutcome } from "../../src/core/schema/validate";
import { CardCompact } from "../../src/domain/card";
import {
  Dashboard,
  DashboardCompact,
  DashboardDetail,
  Dashcard,
  DashcardCompact,
} from "../../src/domain/dashboard";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

const ORDERS_OVERVIEW_NAME = "Orders Overview";
const ORDERS_OVERVIEW_DESCRIPTION = "E2E seeded dashboard with one orders dashcard.";

const ORDERS_OVERVIEW_COMPACT = {
  id: SEEDED.ordersDashboardId,
  name: ORDERS_OVERVIEW_NAME,
  description: ORDERS_OVERVIEW_DESCRIPTION,
  archived: false,
  collection_id: SEEDED.defaultCollectionId,
} as const;

const ORDERS_OVERVIEW_FIRST_DASHCARD_COMPACT = {
  id: SEEDED.ordersDashcardId,
  dashboard_id: SEEDED.ordersDashboardId,
  card_id: SEEDED.ordersCardId,
  dashboard_tab_id: null,
  row: 0,
  col: 0,
  size_x: 12,
  size_y: 6,
} as const;

const ORDERS_OVERVIEW_DETAIL_COMPACT = {
  ...ORDERS_OVERVIEW_COMPACT,
  dashcards: [ORDERS_OVERVIEW_FIRST_DASHCARD_COMPACT],
  tabs: [],
} as const;

describe("dashboard e2e", () => {
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

  async function createScratchCard(name: string): Promise<number> {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        name,
        display: "table",
        visualization_settings: {},
        collection_id: SEEDED.defaultCollectionId,
        dataset_query: {
          type: "native",
          database: SEEDED.warehouseDbId,
          native: { query: "SELECT 1 AS x" },
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, CardCompact).id;
  }

  function singleDashcardBody(name: string, cardId: number) {
    return {
      name,
      collection_id: SEEDED.defaultCollectionId,
      dashcards: [
        {
          id: -1,
          card_id: cardId,
          row: 0,
          col: 0,
          size_x: 12,
          size_y: 6,
          parameter_mappings: [],
          visualization_settings: {},
        },
      ],
    };
  }

  it("list includes the seeded Orders Overview dashboard with no archived rows", async () => {
    const result = await runCli({
      args: ["dashboard", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, DashboardListEnvelope);
    expect(envelope.data.find((row) => row.id === SEEDED.ordersDashboardId)).toEqual(
      ORDERS_OVERVIEW_COMPACT,
    );
    expect(envelope.data.filter((row) => row.archived)).toEqual([]);
  });

  it("list --filter archived returns no rows when nothing is archived", async () => {
    const result = await runCli({
      args: ["dashboard", "list", "--filter", "archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("get returns the seeded dashboard by id in compact form", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardCompact)).toEqual(ORDERS_OVERVIEW_DETAIL_COMPACT);
  });

  it("get --full hydrates dashcards, tabs, and width on the seeded dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const dashboard = parseJson(result.stdout, DashboardDetail);
    expect({
      id: dashboard.id,
      width: dashboard.width,
      enable_embedding: dashboard.enable_embedding,
      auto_apply_filters: dashboard.auto_apply_filters,
      tabs: dashboard.tabs,
      dashcardCount: dashboard.dashcards.length,
    }).toEqual({
      id: SEEDED.ordersDashboardId,
      width: "fixed",
      enable_embedding: false,
      auto_apply_filters: true,
      tabs: [],
      dashcardCount: 1,
    });
  });

  it("get --format text renders the compact key/value pairs", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const labelPadding = "Collection".length;
    const expected = [
      `${"ID".padEnd(labelPadding)}  ${SEEDED.ordersDashboardId}`,
      `${"Name".padEnd(labelPadding)}  ${ORDERS_OVERVIEW_NAME}`,
      `${"Collection".padEnd(labelPadding)}  ${SEEDED.defaultCollectionId}`,
      `${"Archived".padEnd(labelPadding)}  false`,
    ].join("\n");
    expect(result.stdout.trim()).toBe(expected);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/dashboard/9999999.");
  });

  it("cards lists the seeded dashcard for the orders dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "cards", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashcardListEnvelope)).toEqual({
      data: [
        {
          id: SEEDED.ordersDashcardId,
          dashboard_id: SEEDED.ordersDashboardId,
          card_id: SEEDED.ordersCardId,
          dashboard_tab_id: null,
          row: 0,
          col: 0,
          size_x: 12,
          size_y: 6,
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("cards with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "cards", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("create + update round-trip renames the dashboard and adds a dashcard", async () => {
    const createResult = await runCli({
      args: ["dashboard", "create", "--json", "--full"],
      stdin: JSON.stringify({
        name: "e2e_dashboard_new",
        description: "created in test",
        collection_id: SEEDED.defaultCollectionId,
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, Dashboard);
    expect({
      name: created.name,
      description: created.description,
      collection_id: created.collection_id,
      archived: created.archived,
      width: created.width,
    }).toEqual({
      name: "e2e_dashboard_new",
      description: "created in test",
      collection_id: SEEDED.defaultCollectionId,
      archived: false,
      width: "fixed",
    });

    const renameResult = await runCli({
      args: ["dashboard", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ name: "e2e_dashboard_renamed" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(renameResult.exitCode, renameResult.stderr).toBe(0);
    expect(parseJson(renameResult.stdout, DashboardCompact)).toEqual({
      id: created.id,
      name: "e2e_dashboard_renamed",
      description: "created in test",
      archived: false,
      collection_id: SEEDED.defaultCollectionId,
      dashcards: [],
      tabs: [],
    });

    const addCardResult = await runCli({
      args: ["dashboard", "update", String(created.id), "--json", "--full"],
      stdin: JSON.stringify({
        dashcards: [
          {
            id: -1,
            card_id: SEEDED.ordersCardId,
            row: 0,
            col: 0,
            size_x: 8,
            size_y: 4,
            parameter_mappings: [],
            visualization_settings: {},
          },
        ],
        tabs: [],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(addCardResult.exitCode, addCardResult.stderr).toBe(0);
    const withCard = parseJson(addCardResult.stdout, Dashboard);
    const firstDashcard = withCard.dashcards?.[0];
    if (firstDashcard === undefined || withCard.dashcards?.length !== 1) {
      throw new Error(`expected exactly 1 dashcard, got ${JSON.stringify(withCard.dashcards)}`);
    }
    expect({
      dashboard_id: firstDashcard.dashboard_id,
      card_id: firstDashcard.card_id,
      row: firstDashcard.row,
      col: firstDashcard.col,
      size_x: firstDashcard.size_x,
      size_y: firstDashcard.size_y,
    }).toEqual({
      dashboard_id: created.id,
      card_id: SEEDED.ordersCardId,
      row: 0,
      col: 0,
      size_x: 8,
      size_y: 4,
    });
  });

  it("create with dashcards in the body chains a PUT and surfaces them in compact output", async () => {
    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify({
        name: "e2e_dashboard_with_dashcards",
        collection_id: SEEDED.defaultCollectionId,
        dashcards: [
          {
            id: -1,
            card_id: SEEDED.ordersCardId,
            row: 0,
            col: 0,
            size_x: 12,
            size_y: 6,
            parameter_mappings: [],
            visualization_settings: {},
          },
        ],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const compact = parseJson(result.stdout, DashboardCompact);
    const firstDashcard = compact.dashcards?.[0];
    if (firstDashcard === undefined || compact.dashcards?.length !== 1) {
      throw new Error(`expected exactly 1 dashcard, got ${JSON.stringify(compact.dashcards)}`);
    }
    expect(compact).toEqual({
      id: compact.id,
      name: "e2e_dashboard_with_dashcards",
      description: null,
      archived: false,
      collection_id: SEEDED.defaultCollectionId,
      tabs: [],
      dashcards: [
        {
          id: firstDashcard.id,
          dashboard_id: compact.id,
          card_id: SEEDED.ordersCardId,
          dashboard_tab_id: null,
          row: 0,
          col: 0,
          size_x: 12,
          size_y: 6,
        },
      ],
    });
  });

  it("create with a body missing the required name field fails on Zod validation", async () => {
    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify({ description: "no name here" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create with a non-existent card_id fails preflight and does not create a dashboard", async () => {
    const missingCardId = 999_999_999;
    const dashboardName = "e2e_dashboard_preflight_missing";

    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify(singleDashcardBody(dashboardName, missingCardId)),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/dashcards/0/card_id", message: `card ${missingCardId} not found` }],
    });

    const search = await runCli({
      args: ["search", dashboardName, "--models", "dashboard", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(search.exitCode, search.stderr).toBe(0);
    expect(search.stdout).not.toContain(dashboardName);
  });

  it("create with an archived card_id fails preflight with the archived diagnostic", async () => {
    const newCardId = await createScratchCard("e2e_preflight_card_to_archive");
    const archive = await runCli({
      args: ["card", "archive", String(newCardId)],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archive.exitCode, archive.stderr).toBe(0);

    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify(singleDashcardBody("e2e_dashboard_preflight_archived", newCardId)),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/dashcards/0/card_id", message: `card ${newCardId} is archived` }],
    });
  });

  it("update with an archived card_id fails preflight and does not touch the dashboard", async () => {
    const newCardId = await createScratchCard("e2e_preflight_update_card");
    const archive = await runCli({
      args: ["card", "archive", String(newCardId)],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archive.exitCode, archive.stderr).toBe(0);

    const beforeGet = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(beforeGet.exitCode, beforeGet.stderr).toBe(0);
    const beforeDetail = parseJson(beforeGet.stdout, DashboardDetail);

    const result = await runCli({
      args: ["dashboard", "update", String(SEEDED.ordersDashboardId), "--json"],
      stdin: JSON.stringify({
        dashcards: singleDashcardBody("ignored", newCardId).dashcards,
        tabs: [],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/dashcards/0/card_id", message: `card ${newCardId} is archived` }],
    });

    const afterGet = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(afterGet.exitCode, afterGet.stderr).toBe(0);
    const afterDetail = parseJson(afterGet.stdout, DashboardDetail);
    expect(afterDetail.dashcards).toEqual(beforeDetail.dashcards);
    expect(afterDetail.tabs).toEqual(beforeDetail.tabs);
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update-dashcard moves a single dashcard and preserves the others", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(SEEDED.ordersDashboardId),
        String(SEEDED.ordersDashcardId),
        "--json",
      ],
      stdin: JSON.stringify({ row: 4, col: 2, size_x: 10, size_y: 5 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashcardCompact)).toEqual({
      id: SEEDED.ordersDashcardId,
      dashboard_id: SEEDED.ordersDashboardId,
      card_id: SEEDED.ordersCardId,
      dashboard_tab_id: null,
      row: 4,
      col: 2,
      size_x: 10,
      size_y: 5,
    });
  });

  it("update-dashcard rejects an empty patch with a Zod ValidationError", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(SEEDED.ordersDashboardId),
        String(SEEDED.ordersDashcardId),
        "--json",
      ],
      stdin: JSON.stringify({}),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("update-dashcard with an unknown dashcard id fails with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "update-dashcard", String(SEEDED.ordersDashboardId), "9999999", "--json"],
      stdin: JSON.stringify({ row: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `dashcard 9999999 not found on dashboard ${SEEDED.ordersDashboardId}`,
    );
    expect(result.stdout).toBe("");
  });

  it("update-dashcard with a non-integer dashboard id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "update-dashcard", "abc", "1", "--json"],
      stdin: JSON.stringify({ row: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid dashboard-id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });

  it("update-dashcard against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "update-dashcard", "9999999", "1", "--json"],
      stdin: JSON.stringify({ row: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/dashboard/9999999.");
  });

  it("update-dashcard preserves the other dashcards verbatim when patching one of two", async () => {
    const addSecondCardResult = await runCli({
      args: ["dashboard", "update", String(SEEDED.ordersDashboardId), "--json", "--full"],
      stdin: JSON.stringify({
        dashcards: [
          {
            id: SEEDED.ordersDashcardId,
            card_id: SEEDED.ordersCardId,
            row: 0,
            col: 0,
            size_x: 12,
            size_y: 6,
            parameter_mappings: [],
            visualization_settings: {},
          },
          {
            id: -1,
            card_id: SEEDED.ordersCardId,
            row: 7,
            col: 0,
            size_x: 6,
            size_y: 3,
            parameter_mappings: [],
            visualization_settings: {},
          },
        ],
        tabs: [],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(addSecondCardResult.exitCode, addSecondCardResult.stderr).toBe(0);
    const dashboardWithTwo = parseJson(addSecondCardResult.stdout, DashboardDetail);
    expect(dashboardWithTwo.dashcards.length).toBe(2);
    const secondDashcard = dashboardWithTwo.dashcards.find(
      (dashcard) => dashcard.id !== SEEDED.ordersDashcardId,
    );
    if (secondDashcard === undefined) {
      throw new Error("expected a second dashcard after update");
    }

    const patchResult = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(SEEDED.ordersDashboardId),
        String(SEEDED.ordersDashcardId),
        "--json",
      ],
      stdin: JSON.stringify({ row: 99, col: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(patchResult.exitCode, patchResult.stderr).toBe(0);

    const cardsListResult = await runCli({
      args: ["dashboard", "cards", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(cardsListResult.exitCode, cardsListResult.stderr).toBe(0);
    const envelope = parseJson(cardsListResult.stdout, DashcardListEnvelope);
    expect(envelope.data.length).toBe(2);
    const patched = envelope.data.find((dashcard) => dashcard.id === SEEDED.ordersDashcardId);
    const untouched = envelope.data.find((dashcard) => dashcard.id === secondDashcard.id);
    expect(patched).toEqual({
      id: SEEDED.ordersDashcardId,
      dashboard_id: SEEDED.ordersDashboardId,
      card_id: SEEDED.ordersCardId,
      dashboard_tab_id: null,
      row: 99,
      col: 1,
      size_x: 12,
      size_y: 6,
    });
    expect(untouched).toEqual({
      id: secondDashcard.id,
      dashboard_id: SEEDED.ordersDashboardId,
      card_id: SEEDED.ordersCardId,
      dashboard_tab_id: null,
      row: 7,
      col: 0,
      size_x: 6,
      size_y: 3,
    });
  });

  it("update-dashcard patches visualization_settings without disturbing layout fields", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(SEEDED.ordersDashboardId),
        String(SEEDED.ordersDashcardId),
        "--json",
        "--full",
      ],
      stdin: JSON.stringify({
        visualization_settings: { "card.title": "Patched title" },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const patched = parseJson(result.stdout, Dashcard);
    expect({
      id: patched.id,
      row: patched.row,
      col: patched.col,
      size_x: patched.size_x,
      size_y: patched.size_y,
      visualization_settings: patched.visualization_settings,
    }).toEqual({
      id: SEEDED.ordersDashcardId,
      row: 0,
      col: 0,
      size_x: 12,
      size_y: 6,
      visualization_settings: { "card.title": "Patched title" },
    });
  });

  it("update flips archived to true and the archived list reflects it", async () => {
    const archiveResult = await runCli({
      args: ["dashboard", "update", String(SEEDED.ordersDashboardId), "--json"],
      stdin: JSON.stringify({ archived: true }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, DashboardCompact)).toEqual({
      ...ORDERS_OVERVIEW_DETAIL_COMPACT,
      archived: true,
    });

    const archivedListResult = await runCli({
      args: ["dashboard", "list", "--filter", "archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archivedListResult.exitCode, archivedListResult.stderr).toBe(0);
    expect(parseJson(archivedListResult.stdout, DashboardListEnvelope)).toEqual({
      data: [{ ...ORDERS_OVERVIEW_COMPACT, archived: true }],
      returned: 1,
      total: 1,
    });
  });
});
