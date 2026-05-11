import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DashcardListEnvelope } from "../../src/commands/dashboard/cards";
import { DashboardListEnvelope } from "../../src/commands/dashboard/list";
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
import { E2E_CARDS, E2E_COLLECTIONS, E2E_DASHBOARDS, E2E_DASHCARDS } from "./seed/ids";

const ORDERS_OVERVIEW_NAME = "Orders Overview";
const ORDERS_OVERVIEW_DESCRIPTION = "E2E seeded dashboard with one orders dashcard.";

const ORDERS_OVERVIEW_COMPACT = {
  id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
  name: ORDERS_OVERVIEW_NAME,
  description: ORDERS_OVERVIEW_DESCRIPTION,
  archived: false,
  collection_id: E2E_COLLECTIONS.DEFAULT,
} as const;

const ORDERS_OVERVIEW_FIRST_DASHCARD_COMPACT = {
  id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
  dashboard_id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
  card_id: E2E_CARDS.ORDERS_BY_STATUS,
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

  it("list includes the seeded Orders Overview dashboard with no archived rows", async () => {
    const result = await runCli({
      args: ["dashboard", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, DashboardListEnvelope);
    expect(envelope.data.find((row) => row.id === E2E_DASHBOARDS.ORDERS_OVERVIEW)).toEqual(
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
      args: ["dashboard", "get", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardCompact)).toEqual(ORDERS_OVERVIEW_DETAIL_COMPACT);
  });

  it("get --full hydrates dashcards, tabs, and width on the seeded dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json", "--full"],
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
      id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
      width: "fixed",
      enable_embedding: false,
      auto_apply_filters: true,
      tabs: [],
      dashcardCount: 1,
    });
  });

  it("get --format text renders the compact key/value pairs", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const labelPadding = "Collection".length;
    const expected = [
      `${"ID".padEnd(labelPadding)}  ${E2E_DASHBOARDS.ORDERS_OVERVIEW}`,
      `${"Name".padEnd(labelPadding)}  ${ORDERS_OVERVIEW_NAME}`,
      `${"Collection".padEnd(labelPadding)}  ${E2E_COLLECTIONS.DEFAULT}`,
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
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("cards lists the seeded dashcard for the orders dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "cards", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashcardListEnvelope)).toEqual({
      data: [
        {
          id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
          dashboard_id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
          card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("create + update round-trip renames the dashboard and adds a dashcard", async () => {
    const createResult = await runCli({
      args: ["dashboard", "create", "--json", "--full"],
      stdin: JSON.stringify({
        name: "e2e_dashboard_new",
        description: "created in test",
        collection_id: E2E_COLLECTIONS.DEFAULT,
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
      collection_id: E2E_COLLECTIONS.DEFAULT,
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
      collection_id: E2E_COLLECTIONS.DEFAULT,
      dashcards: [],
      tabs: [],
    });

    const addCardResult = await runCli({
      args: ["dashboard", "update", String(created.id), "--json", "--full"],
      stdin: JSON.stringify({
        dashcards: [
          {
            id: -1,
            card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
      card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
        collection_id: E2E_COLLECTIONS.DEFAULT,
        dashcards: [
          {
            id: -1,
            card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
      collection_id: E2E_COLLECTIONS.DEFAULT,
      tabs: [],
      dashcards: [
        {
          id: firstDashcard.id,
          dashboard_id: compact.id,
          card_id: E2E_CARDS.ORDERS_BY_STATUS,
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

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update-dashcard moves a single dashcard and preserves the others", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(E2E_DASHBOARDS.ORDERS_OVERVIEW),
        String(E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST),
        "--json",
      ],
      stdin: JSON.stringify({ row: 4, col: 2, size_x: 10, size_y: 5 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashcardCompact)).toEqual({
      id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
      dashboard_id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
      card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
        String(E2E_DASHBOARDS.ORDERS_OVERVIEW),
        String(E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST),
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
      args: [
        "dashboard",
        "update-dashcard",
        String(E2E_DASHBOARDS.ORDERS_OVERVIEW),
        "9999999",
        "--json",
      ],
      stdin: JSON.stringify({ row: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `dashcard 9999999 not found on dashboard ${E2E_DASHBOARDS.ORDERS_OVERVIEW}`,
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
    expect(result.stderr).toContain('invalid dashboard-id: "abc" (expected integer)');
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
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("update-dashcard preserves the other dashcards verbatim when patching one of two", async () => {
    const addSecondCardResult = await runCli({
      args: ["dashboard", "update", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json", "--full"],
      stdin: JSON.stringify({
        dashcards: [
          {
            id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
            card_id: E2E_CARDS.ORDERS_BY_STATUS,
            row: 0,
            col: 0,
            size_x: 12,
            size_y: 6,
            parameter_mappings: [],
            visualization_settings: {},
          },
          {
            id: -1,
            card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
      (dashcard) => dashcard.id !== E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
    );
    if (secondDashcard === undefined) {
      throw new Error("expected a second dashcard after update");
    }

    const patchResult = await runCli({
      args: [
        "dashboard",
        "update-dashcard",
        String(E2E_DASHBOARDS.ORDERS_OVERVIEW),
        String(E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST),
        "--json",
      ],
      stdin: JSON.stringify({ row: 99, col: 1 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(patchResult.exitCode, patchResult.stderr).toBe(0);

    const cardsListResult = await runCli({
      args: ["dashboard", "cards", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(cardsListResult.exitCode, cardsListResult.stderr).toBe(0);
    const envelope = parseJson(cardsListResult.stdout, DashcardListEnvelope);
    expect(envelope.data.length).toBe(2);
    const patched = envelope.data.find(
      (dashcard) => dashcard.id === E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
    );
    const untouched = envelope.data.find((dashcard) => dashcard.id === secondDashcard.id);
    expect(patched).toEqual({
      id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
      dashboard_id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
      card_id: E2E_CARDS.ORDERS_BY_STATUS,
      dashboard_tab_id: null,
      row: 99,
      col: 1,
      size_x: 12,
      size_y: 6,
    });
    expect(untouched).toEqual({
      id: secondDashcard.id,
      dashboard_id: E2E_DASHBOARDS.ORDERS_OVERVIEW,
      card_id: E2E_CARDS.ORDERS_BY_STATUS,
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
        String(E2E_DASHBOARDS.ORDERS_OVERVIEW),
        String(E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST),
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
      id: E2E_DASHCARDS.ORDERS_OVERVIEW_FIRST,
      row: 0,
      col: 0,
      size_x: 12,
      size_y: 6,
      visualization_settings: { "card.title": "Patched title" },
    });
  });

  it("update flips archived to true and the archived list reflects it", async () => {
    const archiveResult = await runCli({
      args: ["dashboard", "update", String(E2E_DASHBOARDS.ORDERS_OVERVIEW), "--json"],
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
