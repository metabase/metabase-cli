import { Table } from "@metabase/cli/domain";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import {
  AGENT_TIMEOUT_MS,
  type AgentRun,
  cleanupScratch,
  type Live,
  resolveLive,
  runAgent,
  toolNames,
} from "./live";

const PAGE_SIZE = 5;
const READ_TOOLS: ReadonlySet<string> = new Set(["search", "browse_data", "get_content"]);

const ExecuteSqlArgs = z.object({ database_id: z.number().int(), sql: z.string() }).loose();
const ContinuationArgs = z.object({ offset: z.number().int() }).loose();

const live: Live | null = await resolveLive();

afterEach(cleanupScratch);

test.skipIf(live === null)(
  "walks the curated read chain — find a table, run SQL against it, page the result by offset",
  async () => {
    const table = await someTable();

    const run = await runAgent(
      requireLive(),
      `Find the "${table.name}" table in this Metabase instance and tell me which database it belongs to. ` +
        `Then run SQL against that database that selects its rows, and show me the first ${PAGE_SIZE}. ` +
        `Then show me the next ${PAGE_SIZE} by calling execute_sql again with the same SQL and an offset — do not change the SQL.`,
    );

    expect(toolNames(run).some((name) => READ_TOOLS.has(name))).toBe(true);

    const sql = argsOf(run, "execute_sql").map((args) => ExecuteSqlArgs.parse(args));
    expect(sql.map((args) => args.database_id)).toContain(table.db_id);

    const continuations = argsOf(run, "execute_sql")
      .map((args) => ContinuationArgs.safeParse(args))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data.offset);
    expect(continuations).toContain(PAGE_SIZE);
  },
  AGENT_TIMEOUT_MS,
);

function argsOf(run: AgentRun, tool: string): unknown[] {
  return run.toolCalls.filter((call) => call.name === tool).map((call) => call.args);
}

function requireLive(): Live {
  if (live === null) {
    throw new Error("The read smoke needs a model key, MB_URL, and MB_API_KEY.");
  }
  return live;
}

// Whatever instance the operator points the smoke at, one queryable table is all it needs; naming a
// real one keeps the prompt honest without pinning the suite to a seeded fixture.
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
