import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { runExecuteQueryTool } from "./execute-query";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";

const MBQL = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 2 }],
};

const datasetResult: Responder = (path, options) => {
  expect(path).toBe("/api/dataset");
  expect(options?.method).toBe("POST");
  const body = z
    .object({ constraints: z.object({ "max-results": z.number() }) })
    .loose()
    .parse(options?.body);
  expect(body.constraints["max-results"]).toBeGreaterThan(0);
  return {
    status: "completed",
    row_count: 4,
    data: { rows: [[0], [1], [2], [3]], cols: [{ name: "n", base_type: "type/Integer" }] },
  };
};

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-eq-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("requires exactly one of query or query_file", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(runExecuteQueryTool(deps, {})).rejects.toThrow(
    "Provide exactly one of `query` or `query_file`.",
  );
  await expect(runExecuteQueryTool(deps, { query: MBQL, query_file: "q.json" })).rejects.toThrow(
    "Provide exactly one of `query` or `query_file`.",
  );
});

test("executes a query, then continues it with an offset", async () => {
  const { deps } = toolDeps(datasetResult);

  const first = await runExecuteQueryTool(deps, { query: MBQL, row_limit: 2 });
  expect(first.details).toEqual({
    kind: "dataset",
    returned: 2,
    offset: 0,
    columns: [{ name: "n", base_type: "type/Integer" }],
    rows: [[0], [1]],
    continuation: "More rows available — call again with the same `query` and offset 2.",
  });

  const second = await runExecuteQueryTool(deps, { query: MBQL, offset: 2, row_limit: 2 });
  expect(second.details).toEqual({
    kind: "dataset",
    returned: 2,
    offset: 2,
    columns: [{ name: "n", base_type: "type/Integer" }],
    rows: [[2], [3]],
    continuation: "More rows available — call again with the same `query` and offset 4.",
  });
});

test("query_file runs the query stored on disk", async () => {
  const cwd = await scratch();
  await writeFile(join(cwd, "q.json"), JSON.stringify(MBQL));
  const { deps, requests } = toolDeps(datasetResult, cwd);

  const result = await runExecuteQueryTool(deps, { query_file: "q.json" });

  expect(z.object({ returned: z.number() }).loose().parse(result.details).returned).toBe(4);
  const body = z.record(z.string(), z.unknown()).parse(requests[0]?.options?.body);
  expect(body).toEqual({
    ...MBQL,
    constraints: { "max-results": 100, "max-results-bare-rows": 100 },
  });
});

test("a missing query_file names the path it resolved to", async () => {
  const cwd = await scratch();
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  }, cwd);

  await expect(runExecuteQueryTool(deps, { query_file: "gone.json" })).rejects.toBeInstanceOf(
    TeachingError,
  );
  await expect(runExecuteQueryTool(deps, { query_file: "gone.json" })).rejects.toThrow(
    `query_file "gone.json" does not exist (resolved to ${join(cwd, "gone.json")}).`,
  );
});

test("a query_file that is not JSON names the parse failure", async () => {
  const cwd = await scratch();
  await writeFile(join(cwd, "q.json"), "SELECT 1");
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  }, cwd);

  await expect(runExecuteQueryTool(deps, { query_file: "q.json" })).rejects.toThrow(
    'query_file "q.json" is not valid JSON:',
  );
});
