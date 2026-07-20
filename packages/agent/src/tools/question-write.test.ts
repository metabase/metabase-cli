import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { runQuestionWriteTool } from "./question-write";

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-qw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface CardFixture {
  id: number;
  name: string;
  type: string;
  display: string;
  description: string | null;
  archived: boolean;
  query_type: string;
  database_id: number;
  table_id: number;
  collection_id: number | null;
  entity_id: string;
  creator_id: number;
  dataset_query: unknown;
  visualization_settings: unknown;
  result_metadata?: unknown[];
}

function card(overrides: Partial<CardFixture> = {}): CardFixture {
  return {
    id: 42,
    name: "Revenue",
    type: "question",
    display: "table",
    description: null,
    archived: false,
    query_type: "query",
    database_id: 1,
    table_id: 2,
    collection_id: 4,
    entity_id: "e",
    creator_id: 1,
    dataset_query: { "lib/type": "mbql/query" },
    visualization_settings: {},
    ...overrides,
  };
}

const CARD_RESPONDER: Responder = () => card();

const MBQL = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 2 }],
};

test("create sends the REST body and returns the compact card", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  const result = await runQuestionWriteTool(deps, {
    method: "create",
    name: "Revenue",
    query: MBQL,
    display: "line",
  });

  expect(requests).toEqual([
    {
      path: "/api/card",
      method: "POST",
      options: {
        method: "POST",
        body: {
          name: "Revenue",
          type: "question",
          dataset_query: MBQL,
          display: "line",
          visualization_settings: {},
        },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created question 42",
    noun: "question",
    value: {
      id: 42,
      name: "Revenue",
      type: "question",
      display: "table",
      archived: false,
      database_id: 1,
      collection_id: 4,
      description: null,
    },
  });
});

test("create defaults display and visualization_settings the REST API requires", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await runQuestionWriteTool(deps, { method: "create", name: "Revenue", query: MBQL });

  expect(requests[0]?.options?.body).toEqual({
    name: "Revenue",
    type: "question",
    dataset_query: MBQL,
    display: "table",
    visualization_settings: {},
  });
});

test("a query_file saves the exact query stored on disk", async () => {
  const cwd = await scratch();
  await writeFile(join(cwd, "revenue.mbql.json"), JSON.stringify(MBQL));
  const { deps, requests } = toolDeps(CARD_RESPONDER, cwd);

  await runQuestionWriteTool(deps, {
    method: "create",
    name: "Revenue",
    query_file: "revenue.mbql.json",
  });

  expect(requests[0]?.options?.body).toEqual({
    name: "Revenue",
    type: "question",
    dataset_query: MBQL,
    display: "table",
    visualization_settings: {},
  });
});

test("a native sql_file saves the exact SQL stored on disk", async () => {
  const cwd = await scratch();
  await writeFile(join(cwd, "revenue.sql"), "SELECT 1");
  const { deps, requests } = toolDeps(CARD_RESPONDER, cwd);

  await runQuestionWriteTool(deps, {
    method: "create",
    name: "Revenue",
    native: { database_id: 1, sql_file: "revenue.sql" },
  });

  expect(requests[0]?.options?.body).toEqual({
    name: "Revenue",
    type: "question",
    dataset_query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [{ "lib/type": "mbql.stage/native", native: "SELECT 1" }],
    },
    display: "table",
    visualization_settings: {},
  });
});

test("native with both sql and sql_file is rejected", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      native: { database_id: 1, sql: "SELECT 1", sql_file: "revenue.sql" },
    }),
  ).rejects.toThrow("Provide exactly one of `native.sql` or `native.sql_file`.");
});

test("create without a query source names all three", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(runQuestionWriteTool(deps, { method: "create", name: "Revenue" })).rejects.toThrow(
    "Provide exactly one query source (query, query_file, native); received 0.",
  );
});

test("create with two query sources is rejected", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      query: MBQL,
      native: { database_id: 1, sql: "SELECT 1" },
    }),
  ).rejects.toThrow("Provide exactly one query source (query, query_file, native); received 2.");
});

test("create without a name names the missing field", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(runQuestionWriteTool(deps, { method: "create", query: MBQL })).rejects.toThrow(
    "`name` is required for the `create` method.",
  );
});

test("update without an id names the missing field", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(runQuestionWriteTool(deps, { method: "update", name: "x" })).rejects.toThrow(
    "`id` is required for the `update` method. This call carried `method`, `name` and nothing else. `name` does not select an entity — on `update` it is the new title to write.",
  );
});

test("display nested inside visualization_settings is rejected before the request leaves", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      query: MBQL,
      visualization_settings: { display: "bar", "graph.dimensions": ["CATEGORY"] },
    }),
  ).rejects.toThrow(
    "`display` is a top-level argument of this tool, not a `visualization_settings` key — the server stores stray keys without reading them and the card renders as the default table.",
  );
  expect(requests).toEqual([]);
});

test("every card field smuggled into visualization_settings is named at once", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "update",
      id: 42,
      visualization_settings: { display: "bar", name: "Revenue" },
    }),
  ).rejects.toThrow("`display`, `name` are top-level arguments of this tool");
});

test("update patches only the fields it was given, leaving the card's type alone", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await runQuestionWriteTool(deps, {
    method: "update",
    id: 42,
    collection_id: 7,
    collection_position: 1,
  });

  expect(requests).toEqual([
    {
      path: "/api/card/42",
      method: "PUT",
      options: {
        method: "PUT",
        body: { collection_id: 7, collection_position: 1 },
      },
    },
  ]);
});

test("an update converts the card's type only when asked to", async () => {
  const { deps, requests } = toolDeps(() => card({ type: "model" }));

  await runQuestionWriteTool(deps, { method: "update", id: 42, card_type: "model" });

  expect(requests[0]?.options?.body).toEqual({ type: "model" });
});

test("archive and restore ride the update method", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await runQuestionWriteTool(deps, { method: "update", id: 42, archived: true });
  await runQuestionWriteTool(deps, { method: "update", id: 42, archived: false });

  expect(requests.map((request) => request.options?.body)).toEqual([
    { archived: true },
    { archived: false },
  ]);
});

test("a card cannot be saved into a collection and a dashboard at once", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      query: MBQL,
      collection_id: 4,
      dashboard_id: 3,
    }),
  ).rejects.toThrow(
    "A card is saved either in a collection (`collection_id`) or inside a dashboard (`dashboard_id`), not both.",
  );
});

test("native SQL becomes an MBQL 5 native stage with minted tag ids", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await runQuestionWriteTool(deps, {
    method: "create",
    name: "Orders by state",
    native: {
      database_id: 1,
      sql: "SELECT * FROM orders WHERE {{state}}",
      template_tags: { state: { type: "dimension", dimension: ["field", {}, 1779] } },
    },
  });

  expect(requests[0]?.options?.body).toEqual({
    name: "Orders by state",
    type: "question",
    display: "table",
    visualization_settings: {},
    dataset_query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/native",
          native: "SELECT * FROM orders WHERE {{state}}",
          "template-tags": {
            state: {
              id: "4ba69735-ca53-765e-d6a7-09edb56c6ea2",
              name: "state",
              "display-name": "State",
              type: "dimension",
              dimension: ["field", {}, 1779],
            },
          },
        },
      ],
    },
  });
});

test("a metric with two aggregations is rejected before the request leaves", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      card_type: "metric",
      query: {
        "lib/type": "mbql/query",
        database: 1,
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-table": 2,
            aggregation: [
              ["sum", {}, ["field", {}, 1]],
              ["count", {}],
            ],
          },
        ],
      },
    }),
  ).rejects.toThrow(
    "A metric holds exactly one aggregation; this query's last stage has 2. Split the extras into their own metrics, or save this as a question.",
  );
  expect(requests).toEqual([]);
});

test("a metric with two time groupings is rejected before the request leaves", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      card_type: "metric",
      query: {
        "lib/type": "mbql/query",
        database: 1,
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-table": 2,
            aggregation: [["sum", {}, ["field", {}, 1]]],
            breakout: [
              ["field", { "temporal-unit": "month" }, 3],
              ["field", { "temporal-unit": "year" }, 4],
            ],
          },
        ],
      },
    }),
  ).rejects.toThrow(
    "A metric takes at most one time grouping; this query's last stage breaks out by 2. Drop the extras — a question reading the metric can group it further.",
  );
  expect(requests).toEqual([]);
});

test("a metric with one aggregation and one time grouping is written", async () => {
  const { deps, requests } = toolDeps(() => card({ type: "metric" }));

  await runQuestionWriteTool(deps, {
    method: "create",
    name: "Revenue",
    card_type: "metric",
    query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 2,
          aggregation: [["sum", {}, ["field", {}, 1]]],
          breakout: [["field", { "temporal-unit": "month" }, 3]],
        },
      ],
    },
  });

  expect(requests.map((request) => request.path)).toEqual(["/api/card"]);
});

test("column_metadata merges over the model's computed columns", async () => {
  const computed = [
    { name: "ID", display_name: "ID", base_type: "type/BigInteger" },
    { name: "TOTAL", display_name: "TOTAL", base_type: "type/Float" },
  ];
  const { deps, requests } = toolDeps(() => card({ type: "model", result_metadata: computed }));

  await runQuestionWriteTool(deps, {
    method: "create",
    name: "Orders model",
    card_type: "model",
    query: MBQL,
    column_metadata: [
      { name: "TOTAL", display_name: "Order total", semantic_type: "type/Currency" },
    ],
  });

  expect(requests.map((request) => request.path)).toEqual(["/api/card", "/api/card/42"]);
  expect(requests[1]?.options?.body).toEqual({
    result_metadata: [
      { name: "ID", display_name: "ID", base_type: "type/BigInteger" },
      {
        name: "TOTAL",
        display_name: "Order total",
        base_type: "type/Float",
        semantic_type: "type/Currency",
      },
    ],
  });
});

test("column_metadata naming a column the model does not have lists the ones it does", async () => {
  const { deps } = toolDeps(() =>
    card({ type: "model", result_metadata: [{ name: "ID" }, { name: "TOTAL" }] }),
  );

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Orders model",
      card_type: "model",
      query: MBQL,
      column_metadata: [{ name: "SUBTOTAL", display_name: "x" }],
    }),
  ).rejects.toThrow('Model 42 has no column "SUBTOTAL" — its columns are "ID", "TOTAL".');
});

test("column_metadata on a question names the flag that would make it valid", async () => {
  const { deps, requests } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "create",
      name: "Revenue",
      query: MBQL,
      column_metadata: [{ name: "TOTAL" }],
    }),
  ).rejects.toThrow(
    'column_metadata curates a model\'s columns — this card is a question. Set `card_type: "model"` or drop `column_metadata`.',
  );
  expect(requests).toEqual([]);
});

const STAGED_NATIVE = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [
    {
      "lib/type": "mbql.stage/native",
      native: "SELECT * FROM orders WHERE {{state}}",
      "template-tags": {
        state: { id: "abc", name: "state", "display-name": "State", type: "dimension" },
      },
    },
  ],
};

test("pull writes a structured card's query to a JSON file and names the way back", async () => {
  const cwd = await scratch();
  const { deps, requests } = toolDeps(() => card({ dataset_query: MBQL }), cwd);

  const result = await runQuestionWriteTool(deps, { method: "pull", id: 42 });

  const file = join(cwd, "card-42.query.json");
  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/card/42",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled question 42 query to ${file}`,
    value: {
      file,
      note: `Edit the file, then apply it with {method: "update", id: 42, query_file: "${file}"}.`,
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(MBQL);
});

test("pull writes a native card's SQL byte-exactly and returns its template tags", async () => {
  const cwd = await scratch();
  const { deps } = toolDeps(() => card({ dataset_query: STAGED_NATIVE }), cwd);

  const result = await runQuestionWriteTool(deps, { method: "pull", id: 42 });

  const file = join(cwd, "card-42.sql");
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled question 42 SQL to ${file}`,
    value: {
      file,
      database_id: 1,
      template_tags: {
        state: { id: "abc", name: "state", "display-name": "State", type: "dimension" },
      },
      note:
        `Edit the file, then apply it with {method: "update", id: 42, native: {database_id: 1, sql_file: "${file}", template_tags: <the template_tags returned here>}}.` +
        " Pass `template_tags` through unchanged (edited only to match SQL edits) so the card keeps its tag definitions.",
    },
  });
  expect(await readFile(file, "utf8")).toBe("SELECT * FROM orders WHERE {{state}}");
});

test("pull reads a legacy native envelope the same way", async () => {
  const cwd = await scratch();
  const legacy = { type: "native", database: 2, native: { query: "SELECT 1" } };
  const { deps } = toolDeps(() => card({ dataset_query: legacy }), cwd);

  const result = await runQuestionWriteTool(deps, { method: "pull", id: 42 });

  const file = join(cwd, "card-42.sql");
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled question 42 SQL to ${file}`,
    value: {
      file,
      database_id: 2,
      note: `Edit the file, then apply it with {method: "update", id: 42, native: {database_id: 2, sql_file: "${file}"}}.`,
    },
  });
  expect(await readFile(file, "utf8")).toBe("SELECT 1");
});

test("pull then update round-trips the pulled query byte-identically", async () => {
  const cwd = await scratch();
  const { deps, requests } = toolDeps(() => card({ dataset_query: MBQL }), cwd);

  await runQuestionWriteTool(deps, { method: "pull", id: 42 });
  await runQuestionWriteTool(deps, {
    method: "update",
    id: 42,
    query_file: join(cwd, "card-42.query.json"),
  });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/card/42",
    "PUT /api/card/42",
  ]);
  expect(requests[1]?.options?.body).toEqual({ dataset_query: MBQL });
});

test("pull requires an id", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(runQuestionWriteTool(deps, { method: "pull" })).rejects.toThrow(
    "`id` is required for the `pull` method.",
  );
});

test("pull on a card with an empty query names the problem", async () => {
  const { deps } = toolDeps(() => card({ dataset_query: {} }));

  await expect(runQuestionWriteTool(deps, { method: "pull", id: 42 })).rejects.toThrow(
    "Card 42 has no saved query to pull.",
  );
});

test("column_metadata is refused when the card being updated turns out not to be a model", async () => {
  const { deps } = toolDeps(CARD_RESPONDER);

  await expect(
    runQuestionWriteTool(deps, {
      method: "update",
      id: 42,
      column_metadata: [{ name: "TOTAL" }],
    }),
  ).rejects.toThrow(
    'column_metadata curates a model\'s columns — card 42 is a question. Set `card_type: "model"` or drop `column_metadata`.',
  );
});
