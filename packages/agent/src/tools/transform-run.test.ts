import { expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";
import { runTransformRunTool } from "./transform-run";

const EE_59: InstanceContext = {
  url: "https://mb.example.com",
  versionTag: "v1.59.0",
  majorVersion: 59,
  edition: "enterprise",
  tokenFeatures: ["transforms"],
  user: null,
};

interface RunOverrides {
  status: string;
  message: string | null;
}

function runRecord({ status, message }: RunOverrides): unknown {
  return {
    id: 11,
    transform_id: 4,
    run_method: "manual",
    status,
    is_active: false,
    start_time: "2026-07-01T00:00:00Z",
    end_time: "2026-07-01T00:00:05Z",
    message,
    user_id: 1,
  };
}

const TRANSFORM = {
  id: 4,
  name: "Daily orders",
  description: null,
  source: {
    type: "query",
    query: { "lib/type": "mbql/query", database: 1, stages: [] },
  },
  target: { type: "table", database: 1, schema: "public", name: "daily_orders" },
  source_type: "native",
  target_db_id: 1,
  target_table_id: 12,
  entity_id: "e",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  creator_id: 1,
  collection_id: null,
};

function responderFor(status: string, message: string | null = null): Responder {
  return (path) => {
    if (path === "/api/transform/4/run") {
      return { message: "Run started", run_id: 11 };
    }
    if (path === "/api/transform/run/11") {
      return runRecord({ status, message });
    }
    if (path === "/api/transform/4") {
      return TRANSFORM;
    }
    throw new Error(`unexpected path ${path}`);
  };
}

test("run waits for the terminal status and returns the output table id", async () => {
  const { deps, requests } = toolDeps(responderFor("succeeded"), "/tmp", EE_59);

  const result = await runTransformRunTool(deps, { action: "run", id: 4 });

  expect(requests.map((request) => request.path)).toEqual([
    "/api/transform/4/run",
    "/api/transform/run/11",
    "/api/transform/4",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "run 11 succeeded — output is table 12",
    value: { run_id: 11, status: "succeeded", message: null, target_table_id: 12 },
  });
});

test("a failed run is a teaching error carrying the server's own message", async () => {
  const { deps } = toolDeps(
    responderFor("failed", 'relation "orders" does not exist'),
    "/tmp",
    EE_59,
  );

  await expect(runTransformRunTool(deps, { action: "run", id: 4 })).rejects.toThrow(
    new TeachingError(
      'Run 11 of transform 4 failed. Metabase reported: relation "orders" does not exist Fix the transform\'s source with `transform_write` and run it again — a re-run of the same body fails the same way.',
    ),
  );
});

test("wait: false returns the ticket without polling", async () => {
  const { deps, requests } = toolDeps(responderFor("succeeded"), "/tmp", EE_59);

  const result = await runTransformRunTool(deps, {
    action: "run",
    id: 4,
    wait: false,
    sync: false,
  });

  expect(requests.map((request) => request.path)).toEqual(["/api/transform/4/run"]);
  expect(result.details).toEqual({
    kind: "json",
    label: "started run 11 of transform 4",
    value: { run_id: 11, transform_id: 4, message: "Run started" },
  });
});

const ALREADY_RUNNING: Responder = () => ({
  message: "A run is already in progress.",
  run_id: null,
});

test("a transform that will not start names the call that shows the run in flight", async () => {
  const { deps } = toolDeps(ALREADY_RUNNING, "/tmp", EE_59);

  await expect(runTransformRunTool(deps, { action: "run", id: 4 })).rejects.toThrow(
    new TeachingError(
      'Transform 4 did not start: A run is already in progress. A run already in flight is the usual cause — `{action: "list_runs", transform_id: 4}` shows it.',
    ),
  );
});

test("list_runs filters by transform and projects each run compactly", async () => {
  const responder: Responder = () => ({
    data: [runRecord({ status: "succeeded", message: null })],
    total: 1,
    limit: 50,
    offset: 0,
  });
  const { deps, requests } = toolDeps(responder, "/tmp", EE_59);

  const result = await runTransformRunTool(deps, { action: "list_runs", transform_id: 4 });

  expect(requests).toEqual([
    {
      path: "/api/transform/run",
      method: "GET",
      options: { query: { "transform-ids": 4, limit: 50, offset: 0 } },
    },
  ]);
  expect(result.details).toEqual({
    kind: "list",
    noun: "transform runs",
    envelope: {
      data: [
        {
          id: 11,
          transform_id: 4,
          status: "succeeded",
          run_method: "manual",
          start_time: "2026-07-01T00:00:00Z",
          end_time: "2026-07-01T00:00:05Z",
          message: null,
        },
      ],
      returned: 1,
      total: 1,
    },
  });
});

test("cancel stops the in-flight run", async () => {
  const { deps, requests } = toolDeps(() => null, "/tmp", EE_59);

  const result = await runTransformRunTool(deps, { action: "cancel", id: 4 });

  expect(requests).toEqual([
    {
      path: "/api/transform/4/cancel",
      method: "POST",
      options: { method: "POST", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "canceled the current run of transform 4",
    value: { transform_id: 4, canceled: true },
  });
});

test("an action that needs an id says which id it needs", async () => {
  const { deps } = toolDeps(() => null, "/tmp", EE_59);

  await expect(runTransformRunTool(deps, { action: "get_run" })).rejects.toThrow(
    new TeachingError("`get_run` needs `id` — the run you want."),
  );
});
