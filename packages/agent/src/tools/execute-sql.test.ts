import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { runExecuteSqlTool } from "./execute-sql";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-es-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("requires exactly one of sql or sql_file", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(runExecuteSqlTool(deps, { database_id: 1 })).rejects.toThrow(
    "Provide exactly one of `sql` or `sql_file`.",
  );
  await expect(
    runExecuteSqlTool(deps, { database_id: 1, sql: "SELECT 1", sql_file: "q.sql" }),
  ).rejects.toThrow("Provide exactly one of `sql` or `sql_file`.");
});

test("sql_file runs the SQL stored on disk", async () => {
  const cwd = await scratch();
  await writeFile(join(cwd, "count.sql"), "SELECT count(*) FROM orders");
  const handler: Responder = (path) => {
    expect(path).toBe("/api/dataset");
    return { status: "completed", data: { rows: [[7]], cols: [{ name: "count" }] } };
  };
  const { deps, requests } = toolDeps(handler, cwd);

  await runExecuteSqlTool(deps, { database_id: 1, sql_file: "count.sql" });

  const body = z.record(z.string(), z.unknown()).parse(requests[0]?.options?.body);
  expect(body).toEqual({
    database: 1,
    type: "native",
    native: { query: "SELECT count(*) FROM orders", "template-tags": {} },
    parameters: [],
    constraints: { "max-results": 100, "max-results-bare-rows": 100 },
  });
});

test("rejects a template value with no matching placeholder", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(
    runExecuteSqlTool(deps, { database_id: 1, sql: "SELECT 1", template_tag_values: { foo: 1 } }),
  ).rejects.toBeInstanceOf(TeachingError);
  await expect(
    runExecuteSqlTool(deps, { database_id: 1, sql: "SELECT 1", template_tag_values: { foo: 1 } }),
  ).rejects.toThrow(
    "template_tag_values names foo that don't appear as {{foo}} in the SQL. Add the placeholder or drop the value.",
  );
});

test("compiles a native query with template tags and parameters", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/dataset");
    return { status: "completed", data: { rows: [], cols: [] } };
  };
  const { deps, requests } = toolDeps(handler);
  await runExecuteSqlTool(deps, {
    database_id: 1,
    sql: "SELECT * FROM orders WHERE id = {{id}}",
    template_tag_values: { id: 42 },
  });
  const body = z.record(z.string(), z.unknown()).parse(requests[0]?.options?.body);
  expect(body).toEqual({
    database: 1,
    type: "native",
    native: {
      query: "SELECT * FROM orders WHERE id = {{id}}",
      "template-tags": { id: { id: "id", name: "id", "display-name": "id", type: "number" } },
    },
    parameters: [{ type: "number/=", target: ["variable", ["template-tag", "id"]], value: 42 }],
    constraints: { "max-results": 100, "max-results-bare-rows": 100 },
  });
});
