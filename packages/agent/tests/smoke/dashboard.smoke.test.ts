import { Card, Dashboard, DashboardDetail, Table } from "@metabase/cli/domain";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { AGENT_TIMEOUT_MS, cleanupScratch, type Live, resolveLive, runAgent } from "./live";

const HEADING = "Smoke heading";
const FILTER_NAME = "Row limit";
const TAG = "row_limit";

const live: Live | null = await resolveLive();

afterEach(cleanupScratch);

// `dashboard_write`'s layout document is the harness's hardest tool payload: nested arrays of
// heterogeneous entries, with a dashcard mapping a parameter the same document declares. A provider
// that truncates or flattens tool arguments fails here and nowhere else.
test.skipIf(live === null)(
  "authors a question and a dashboard layout — heading, card, and a filter mapped to it",
  async () => {
    const table = await someTable();
    const suffix = String(Date.now());
    const questionName = `Smoke rows ${suffix}`;
    const dashboardName = `Smoke dashboard ${suffix}`;

    await runAgent(
      requireLive(),
      `In this Metabase instance, create a native SQL question named "${questionName}" against the database holding the "${table.name}" table. ` +
        `The SQL selects rows from that table with a row limit driven by a number template tag {{${TAG}}} that defaults to 5. ` +
        `Then create a dashboard named "${dashboardName}" that holds, in one dashboard_write call: a heading "${HEADING}", the question you just saved, ` +
        `and a number filter named "${FILTER_NAME}" mapped to that card's ${TAG} variable.`,
    );

    const dashboard = await findDashboard(dashboardName);
    try {
      const detail = await readDashboard(dashboard.id);
      const headings = detail.dashcards.filter((dashcard) => dashcard.card_id === null);
      const cards = detail.dashcards.filter((dashcard) => dashcard.card_id !== null);

      expect(headings.length).toBe(1);
      expect(cards.length).toBe(1);
      expect(detail.parameters?.map((parameter) => parameter.name)).toEqual([FILTER_NAME]);

      const wired = cards.flatMap((dashcard) => dashcard.parameter_mappings ?? []);
      expect(wired.map((mapping) => mapping.parameter_id)).toEqual(
        detail.parameters?.map((parameter) => parameter.id),
      );
    } finally {
      await archiveDashboard(dashboard.id);
      await archiveCard(questionName);
    }
  },
  AGENT_TIMEOUT_MS,
);

function requireLive(): Live {
  if (live === null) {
    throw new Error("The dashboard smoke needs a model key, MB_URL, and MB_API_KEY.");
  }
  return live;
}

async function someTable(): Promise<Table> {
  const tables = await requireLive().connection.client.requestParsed(z.array(Table), "/api/table");
  const queryable = tables.find(
    (table) =>
      table.active !== false &&
      (table.visibility_type === null || table.visibility_type === undefined),
  );
  if (queryable === undefined) {
    throw new Error(`No queryable table on ${requireLive().connection.url}.`);
  }
  return queryable;
}

async function findDashboard(name: string): Promise<Dashboard> {
  const dashboards = await requireLive().connection.client.requestParsed(
    z.array(Dashboard),
    "/api/dashboard",
  );
  const match = dashboards.find((dashboard) => dashboard.name === name);
  if (match === undefined) {
    throw new Error(`The agent did not create a dashboard named "${name}".`);
  }
  return match;
}

async function readDashboard(id: number): Promise<DashboardDetail> {
  return requireLive().connection.client.requestParsed(DashboardDetail, `/api/dashboard/${id}`);
}

async function archiveDashboard(id: number): Promise<void> {
  await requireLive().connection.client.requestParsed(Dashboard, `/api/dashboard/${id}`, {
    method: "PUT",
    body: { archived: true },
  });
}

async function archiveCard(name: string): Promise<void> {
  const client = requireLive().connection.client;
  const cards = await client.requestParsed(z.array(Card), "/api/card");
  for (const card of cards.filter((candidate) => candidate.name === name)) {
    await client.requestParsed(Card, `/api/card/${card.id}`, {
      method: "PUT",
      body: { archived: true },
    });
  }
}
