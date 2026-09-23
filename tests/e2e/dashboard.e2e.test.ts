import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DashboardCompact, DashboardDetail } from "@metabase/client/domain/dashboard";
import { parseJson } from "@metabase/client/json";

import { DashcardListEnvelope } from "../../packages/cli/src/commands/dashboard/cards";
import { DashboardListEnvelope } from "../../packages/cli/src/commands/dashboard/list";
import { listEnvelopeSchema } from "../../packages/cli/src/output/types";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
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

const ProjectedDashboardDetail = z.strictObject({
  name: z.string(),
  collection_id: z.number().int().nullable(),
});

const ProjectedDashboardRow = z.strictObject({
  id: z.number().int(),
  name: z.string(),
});
const ProjectedDashboardListEnvelope = listEnvelopeSchema(ProjectedDashboardRow);

describe("dashboard e2e", () => {
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

  it("list includes the seeded Orders Overview dashboard with no archived rows", async () => {
    const result = await runCli({
      args: ["dashboard", "list", "--json"],
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
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("get returns the seeded dashboard by id in compact form", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardCompact)).toEqual(ORDERS_OVERVIEW_DETAIL_COMPACT);
  });

  it("get --full hydrates dashcards, tabs, and width on the seeded dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--json", "--full"],
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
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "get", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/dashboard/9999999.");
  });

  it("get --fields projects only the requested top-level fields", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "get",
        String(SEEDED.ordersDashboardId),
        "--fields",
        "name,collection_id",
        "--json",
      ],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ProjectedDashboardDetail)).toEqual({
      name: ORDERS_OVERVIEW_NAME,
      collection_id: SEEDED.defaultCollectionId,
    });
  });

  it("get --fields with an empty value falls back to the compact projection", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--fields", "", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DashboardCompact)).toEqual(ORDERS_OVERVIEW_DETAIL_COMPACT);
  });

  it("get --fields with an unknown path fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "get", String(SEEDED.ordersDashboardId), "--fields", "nope", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('unknown field path: "nope"');
    expect(result.stdout).toBe("");
  });

  it("rejects --fields combined with --full", async () => {
    const result = await runCli({
      args: [
        "dashboard",
        "get",
        String(SEEDED.ordersDashboardId),
        "--fields",
        "name",
        "--full",
        "--json",
      ],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      "--full conflicts with --fields (use one or neither)",
    );
    expect(result.stdout).toBe("");
  });

  it("list --fields projects each row to the requested fields", async () => {
    const result = await runCli({
      args: ["dashboard", "list", "--fields", "id,name", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, ProjectedDashboardListEnvelope);
    expect(envelope.data.find((row) => row.id === SEEDED.ordersDashboardId)).toEqual({
      id: SEEDED.ordersDashboardId,
      name: ORDERS_OVERVIEW_NAME,
    });
  });

  it("cards lists the seeded dashcard for the orders dashboard", async () => {
    const result = await runCli({
      args: ["dashboard", "cards", String(SEEDED.ordersDashboardId), "--json"],
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
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("cards with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "cards", "abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
