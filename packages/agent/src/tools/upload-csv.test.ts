import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";
import { runUploadCsvTool } from "./upload-csv";

const CSV = "id,name\n1,Ada\n";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function csvDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-upload-"));
  dirs.push(dir);
  await writeFile(join(dir, "people.csv"), CSV, "utf8");
  return dir;
}

const CREATED: Responder = () =>
  new Response("42", { status: 200, headers: { "metabase-table-id": "7" } });

test("create uploads the file and reports the new table and model", async () => {
  const cwd = await csvDir();
  const { deps, requests } = toolDeps(CREATED, cwd);

  const result = await runUploadCsvTool(deps, {
    action: "create",
    file: "people.csv",
    collection_id: 5,
  });

  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request?.path).toBe("/api/upload/csv");
  expect(request?.method).toBe("POST");
  const body = request?.options?.body;
  expect(body).toBeInstanceOf(FormData);
  if (body instanceof FormData) {
    expect(body.get("collection_id")).toBe("5");
    const file = body.get("file");
    expect(file).toBeInstanceOf(Blob);
    if (file instanceof Blob) {
      expect(await file.text()).toBe(CSV);
    }
  }
  expect(result.details).toEqual({
    kind: "json",
    label: "uploaded people.csv — created table 7 and model 42",
    value: { model_id: 42, table_id: 7 },
  });
});

test("create with no collection lands the model in the root collection", async () => {
  const cwd = await csvDir();
  const { deps, requests } = toolDeps(CREATED, cwd);

  await runUploadCsvTool(deps, { action: "create", file: "people.csv" });

  const body = requests[0]?.options?.body;
  expect(body).toBeInstanceOf(FormData);
  if (body instanceof FormData) {
    expect(body.get("collection_id")).toBe("root");
  }
});

test("append posts to the table's append endpoint", async () => {
  const cwd = await csvDir();
  const { deps, requests } = toolDeps(() => new Response(null, { status: 200 }), cwd);

  const result = await runUploadCsvTool(deps, {
    action: "append",
    file: "people.csv",
    table_id: 7,
  });

  expect(requests.map((request) => request.path)).toEqual(["/api/table/7/append-csv"]);
  expect(result.details).toEqual({
    kind: "json",
    label: "appended to table 7 from people.csv",
    value: { table_id: 7, action: "append" },
  });
});

test("append without a table names the action that makes one", async () => {
  const cwd = await csvDir();
  const { deps, requests } = toolDeps(CREATED, cwd);

  await expect(runUploadCsvTool(deps, { action: "append", file: "people.csv" })).rejects.toThrow(
    new TeachingError(
      '`append` needs `table_id` — the uploaded table to write into. To make one from this file instead, call `upload_csv` with `{action: "create"}`.',
    ),
  );
  expect(requests).toEqual([]);
});

test("a missing file names the path it resolved", async () => {
  const cwd = await csvDir();
  const { deps } = toolDeps(CREATED, cwd);

  await expect(runUploadCsvTool(deps, { action: "create", file: "absent.csv" })).rejects.toThrow(
    new TeachingError(`file "absent.csv" does not exist (resolved to ${join(cwd, "absent.csv")}).`),
  );
});
