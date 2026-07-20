import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "@metabase/cli/errors";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { runDashboardWriteTool, templateTagKinds } from "./dashboard-write";
import { type Responder, toolDeps } from "./fake-client";

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-dw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface DashboardFixture {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  collection_id: number | null;
  creator_id: number;
  entity_id: string;
  width: string;
  auto_apply_filters: boolean;
  enable_embedding: boolean;
  public_uuid: string | null;
  cache_ttl: number | null;
  parameters: unknown[];
  dashcards: unknown[];
  tabs: unknown[];
}

function dashboard(overrides: Partial<DashboardFixture> = {}): DashboardFixture {
  return {
    id: 3,
    name: "Q3 Review",
    description: null,
    archived: false,
    collection_id: 4,
    creator_id: 1,
    entity_id: "e",
    width: "fixed",
    auto_apply_filters: true,
    enable_embedding: false,
    public_uuid: null,
    cache_ttl: null,
    parameters: [],
    dashcards: [],
    tabs: [],
    ...overrides,
  };
}

function nativeCard(id: number): Record<string, unknown> {
  return {
    id,
    name: "Orders",
    type: "question",
    display: "table",
    description: null,
    archived: false,
    query_type: "native",
    database_id: 1,
    table_id: 2,
    collection_id: 4,
    entity_id: "e",
    creator_id: 1,
    visualization_settings: {},
    dataset_query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/native",
          native: "SELECT * FROM orders WHERE {{state}}",
          "template-tags": { state: { type: "dimension", name: "state" } },
        },
      ],
    },
  };
}

function structuredCard(id: number, display = "table"): Record<string, unknown> {
  return {
    ...nativeCard(id),
    display,
    query_type: "query",
    dataset_query: { "lib/type": "mbql/query" },
  };
}

const DASHCARD_RESPONSE = {
  id: 55,
  dashboard_id: 3,
  card_id: 10,
  dashboard_tab_id: null,
  row: 1,
  col: 0,
  size_x: 12,
  size_y: 6,
  entity_id: null,
  visualization_settings: {},
  parameter_mappings: [],
  inline_parameters: [],
};

test("create with an inline layout posts the dashboard, then writes the compiled canvas in one PUT", async () => {
  const handler: Responder = (path, options) => {
    if (path === "/api/card/10") {
      return structuredCard(10, "line");
    }
    if (path === "/api/dashboard" && options?.method === "POST") {
      return dashboard();
    }
    if (path === "/api/dashboard/3" && options?.method === "PUT") {
      return dashboard({ dashcards: [{ ...DASHCARD_RESPONSE }] });
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler);

  const result = await runDashboardWriteTool(deps, {
    method: "create",
    name: "Q3 Review",
    collection_id: 4,
    layout: {
      parameters: [{ id: "created_at", name: "Created At", type: "date/all-options" }],
      dashcards: [
        { heading: "Q3" },
        { card_id: 10, parameter_mappings: [{ parameter_id: "created_at", target_field: 1779 }] },
      ],
    },
  });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/card/10",
    "POST /api/dashboard",
    "PUT /api/dashboard/3",
  ]);
  expect(requests[1]?.options?.body).toEqual({ name: "Q3 Review", collection_id: 4 });
  expect(requests[2]?.options?.body).toEqual({
    tabs: [],
    parameters: [
      {
        id: "created_at",
        name: "Created At",
        slug: "created_at",
        type: "date/all-options",
        sectionId: "date",
      },
    ],
    dashcards: [
      {
        id: -1,
        card_id: null,
        action_id: null,
        dashboard_tab_id: null,
        row: 0,
        col: 0,
        size_x: 24,
        size_y: 1,
        visualization_settings: {
          virtual_card: {
            name: null,
            display: "heading",
            visualization_settings: {},
            dataset_query: {},
            archived: false,
          },
          "dashcard.background": false,
          text: "Q3",
        },
        parameter_mappings: [],
        inline_parameters: [],
        series: [],
      },
      {
        id: -2,
        card_id: 10,
        action_id: null,
        dashboard_tab_id: null,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        visualization_settings: {},
        parameter_mappings: [
          { parameter_id: "created_at", card_id: 10, target: ["dimension", ["field", 1779, null]] },
        ],
        inline_parameters: [],
        series: [],
      },
    ],
  });
  expect(result.details).toEqual({
    kind: "json",
    label: "created dashboard 3",
    noun: "dashboard",
    value: {
      id: 3,
      name: "Q3 Review",
      description: null,
      archived: false,
      collection_id: 4,
      tabs: [],
      dashcards: [
        {
          id: 55,
          dashboard_id: 3,
          card_id: 10,
          dashboard_tab_id: null,
          row: 1,
          col: 0,
          size_x: 12,
          size_y: 6,
        },
      ],
      parameters: [],
    },
  });
});

test("create without a layout writes the dashboard and nothing else", async () => {
  const { deps, requests } = toolDeps(() => dashboard());

  await runDashboardWriteTool(deps, { method: "create", name: "Q3 Review" });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /api/dashboard",
  ]);
  expect(requests[0]?.options?.body).toEqual({ name: "Q3 Review" });
});

test("a fields-only update never touches dashcards, so nothing is deleted", async () => {
  const { deps, requests } = toolDeps(() => dashboard({ archived: true }));

  await runDashboardWriteTool(deps, { method: "update", id: 3, archived: true });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "PUT /api/dashboard/3",
  ]);
  expect(requests[0]?.options?.body).toEqual({ archived: true });
});

test("pull writes the editable layout to a file and names the way back", async () => {
  const cwd = await scratch();
  const handler: Responder = (path) => {
    if (path === "/api/dashboard/3") {
      return dashboard({ dashcards: [{ ...DASHCARD_RESPONSE }] });
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps } = toolDeps(handler, cwd);

  const result = await runDashboardWriteTool(deps, { method: "pull", id: 3 });

  const file = join(cwd, "dashboard-3.layout.json");
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled dashboard 3 layout to ${file}`,
    value: {
      file,
      dashcards: 1,
      tabs: 0,
      parameters: 0,
      note: `Edit the file, then apply it with {method: "update", id: 3, layout_file: "${file}"}. The document is the complete canvas — dashcards you remove from it are removed from the dashboard.`,
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    dashcards: [{ id: 55, card_id: 10, row: 1, col: 0, size_x: 12, size_y: 6 }],
  });
});

test("an update applies an edited layout file as one full-document PUT", async () => {
  const cwd = await scratch();
  await writeFile(
    join(cwd, "dashboard-3.layout.json"),
    JSON.stringify({
      dashcards: [{ id: 55, card_id: 10, row: 1, col: 0, size_x: 12, size_y: 6 }, { card_id: 11 }],
    }),
  );
  const handler: Responder = (path, options) => {
    if (path === "/api/dashboard/3" && options?.method === undefined) {
      return dashboard({ dashcards: [{ ...DASHCARD_RESPONSE }] });
    }
    if (path === "/api/card/10") {
      return structuredCard(10);
    }
    if (path === "/api/card/11") {
      return structuredCard(11, "scalar");
    }
    if (path === "/api/dashboard/3" && options?.method === "PUT") {
      return dashboard();
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler, cwd);

  await runDashboardWriteTool(deps, {
    method: "update",
    id: 3,
    layout_file: "dashboard-3.layout.json",
  });

  expect(requests.map((request) => `${request.method} ${request.path}`).toSorted()).toEqual([
    "GET /api/card/10",
    "GET /api/card/11",
    "GET /api/dashboard/3",
    "PUT /api/dashboard/3",
  ]);
  expect(requests.at(-1)?.options?.body).toEqual({
    tabs: [],
    parameters: [],
    dashcards: [
      {
        id: 55,
        card_id: 10,
        action_id: null,
        dashboard_tab_id: null,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        visualization_settings: {},
        parameter_mappings: [],
        inline_parameters: [],
        series: [],
      },
      {
        id: -1,
        card_id: 11,
        action_id: null,
        dashboard_tab_id: null,
        row: 0,
        col: 12,
        size_x: 6,
        size_y: 3,
        visualization_settings: {},
        parameter_mappings: [],
        inline_parameters: [],
        series: [],
      },
    ],
  });
});

test("layout and layout_file together are rejected", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });

  await expect(
    runDashboardWriteTool(deps, {
      method: "update",
      id: 3,
      layout: { dashcards: [] },
      layout_file: "dashboard-3.layout.json",
    }),
  ).rejects.toThrow("Provide at most one of `layout` or `layout_file`.");
});

test("validate_only compiles the layout and writes nothing", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/card/10") {
      return structuredCard(10);
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler);

  const result = await runDashboardWriteTool(deps, {
    method: "create",
    name: "Q3 Review",
    validate_only: true,
    layout: { dashcards: [{ card_id: 10 }] },
  });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/card/10",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "layout validated (not written)",
    value: {
      validated: true,
      written: false,
      tabs: [],
      parameters: [],
      dashcards: [
        {
          id: -1,
          card_id: 10,
          action_id: null,
          dashboard_tab_id: null,
          row: 0,
          col: 0,
          size_x: 12,
          size_y: 9,
          visualization_settings: {},
          parameter_mappings: [],
          inline_parameters: [],
          series: [],
        },
      ],
    },
  });
});

test("a layout that fails validation aborts before any write", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/dashboard/3") {
      return dashboard();
    }
    if (path === "/api/card/10") {
      return structuredCard(10);
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler);

  await expect(
    runDashboardWriteTool(deps, {
      method: "update",
      id: 3,
      layout: { dashcards: [{ id: 41, card_id: 10 }] },
    }),
  ).rejects.toThrow(
    "dashcards[0]: dashcard 41 is not on this dashboard — pull the current layout to see its dashcards, or drop `id` to add a new card.",
  );
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
});

test("mapping a native card's tag reads the tag kind off the card itself", async () => {
  const handler: Responder = (path, options) => {
    if (path === "/api/dashboard/3" && options?.method === undefined) {
      return dashboard({ dashcards: [{ ...DASHCARD_RESPONSE }] });
    }
    if (path === "/api/card/10") {
      return nativeCard(10);
    }
    if (path === "/api/dashboard/3" && options?.method === "PUT") {
      return dashboard();
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler);

  await runDashboardWriteTool(deps, {
    method: "update",
    id: 3,
    layout: {
      parameters: [{ id: "state", name: "State", type: "string/=" }],
      dashcards: [
        {
          id: 55,
          card_id: 10,
          row: 1,
          col: 0,
          size_x: 12,
          size_y: 6,
          parameter_mappings: [{ parameter_id: "state", target_tag: "state" }],
        },
      ],
    },
  });

  const body = requests.at(-1)?.options?.body;
  expect(body).toEqual({
    tabs: [],
    parameters: [
      { id: "state", name: "State", slug: "state", type: "string/=", sectionId: "string" },
    ],
    dashcards: [
      {
        id: 55,
        card_id: 10,
        action_id: null,
        dashboard_tab_id: null,
        row: 1,
        col: 0,
        size_x: 12,
        size_y: 6,
        visualization_settings: {},
        parameter_mappings: [
          {
            parameter_id: "state",
            card_id: 10,
            target: ["dimension", ["template-tag", "state"]],
          },
        ],
        inline_parameters: [],
        series: [],
      },
    ],
  });
});

test("an archived card cannot be added to a dashboard", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/card/10") {
      return { ...structuredCard(10), archived: true };
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps } = toolDeps(handler);

  await expect(
    runDashboardWriteTool(deps, {
      method: "create",
      name: "Q3",
      layout: { dashcards: [{ card_id: 10 }] },
    }),
  ).rejects.toThrow("dashcards[0]: card 10 does not exist or is not readable.");
});

test("a card that 404s is reported as the dashcard that named it, not as an HTTP failure", async () => {
  const { deps, requests } = toolDeps(() => {
    throw new HttpError({
      status: 404,
      statusText: "Not Found",
      method: "GET",
      url: "http://localhost:3000/api/card/999",
      rawBody: JSON.stringify({ message: "Not found." }),
      responseHeaders: {},
    });
  });

  await expect(
    runDashboardWriteTool(deps, {
      method: "create",
      name: "Q3",
      layout: { dashcards: [{ heading: "Q3" }, { card_id: 999 }] },
    }),
  ).rejects.toThrow("dashcards[1]: card 999 does not exist or is not readable.");
  expect(requests.map((request) => request.method)).toEqual(["GET"]);
});

test("pull requires an id", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });

  await expect(runDashboardWriteTool(deps, { method: "pull" })).rejects.toThrow(
    "`id` is required for the `pull` method.",
  );
});

test("validate_only without a layout is rejected", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });

  await expect(
    runDashboardWriteTool(deps, { method: "update", id: 3, validate_only: true }),
  ).rejects.toThrow("validate_only checks a layout — pass `layout` or `layout_file`.");
});

test("template tags are read from an MBQL 5 native stage and a legacy native query alike", () => {
  const staged = {
    stages: [
      {
        "template-tags": {
          state: { type: "dimension" },
          min: { type: "number" },
          frag: { type: "snippet" },
        },
      },
    ],
  };
  expect(templateTagKinds(staged)).toEqual(
    new Map([
      ["state", "dimension"],
      ["min", "variable"],
    ]),
  );

  const legacy = { native: { "template-tags": { state: { type: "dimension" } } } };
  expect(templateTagKinds(legacy)).toEqual(new Map([["state", "dimension"]]));
});

const LayoutFileShape = z.object({ dashcards: z.array(z.record(z.string(), z.unknown())) });

test("pull then update round-trips: the edited document keeps the dashcard it mentions", async () => {
  const cwd = await scratch();
  const handler: Responder = (path, options) => {
    if (path === "/api/dashboard/3" && options?.method === undefined) {
      return dashboard({ dashcards: [{ ...DASHCARD_RESPONSE }] });
    }
    if (path === "/api/card/10") {
      return structuredCard(10);
    }
    if (path === "/api/dashboard/3" && options?.method === "PUT") {
      return dashboard();
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler, cwd);

  await runDashboardWriteTool(deps, { method: "pull", id: 3 });
  const file = join(cwd, "dashboard-3.layout.json");
  const pulled = LayoutFileShape.parse(JSON.parse(await readFile(file, "utf8")));
  await writeFile(file, JSON.stringify({ dashcards: [{ ...pulled.dashcards[0], size_x: 24 }] }));

  await runDashboardWriteTool(deps, {
    method: "update",
    id: 3,
    layout_file: "dashboard-3.layout.json",
  });

  const body = z
    .object({ dashcards: z.array(z.object({ id: z.number(), size_x: z.number() }).loose()) })
    .loose()
    .parse(requests.at(-1)?.options?.body);
  expect(body.dashcards).toEqual([
    {
      id: 55,
      card_id: 10,
      action_id: null,
      dashboard_tab_id: null,
      row: 1,
      col: 0,
      size_x: 24,
      size_y: 6,
      visualization_settings: {},
      parameter_mappings: [],
      inline_parameters: [],
      series: [],
    },
  ]);
});
