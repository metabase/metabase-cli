import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { type Responder, toolDeps } from "./fake-client";
import { runSavedQuestion } from "./run-saved-question";
import { TeachingError } from "./teaching-error";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-rsq-"));
  tempDirs.push(dir);
  return dir;
}

const cardWithParam = {
  id: 42,
  parameters: [
    { id: "p1", slug: "category", type: "category", target: ["variable", ["template-tag", "c"]] },
  ],
};

test("rejects a parameter the card does not declare", async () => {
  const { deps } = toolDeps(() => cardWithParam);
  await expect(
    runSavedQuestion(deps, { id: 42, parameters: [{ slug: "nope", value: 1 }] }),
  ).rejects.toBeInstanceOf(TeachingError);
  await expect(
    runSavedQuestion(deps, { id: 42, parameters: [{ slug: "nope", value: 1 }] }),
  ).rejects.toThrow('Card 42 has no parameter "nope". Available: category.');
});

test("resolves a slug to the declared parameter and projects the result", async () => {
  const handler: Responder = (path, options) => {
    if (path === "/api/card/42") {
      return cardWithParam;
    }
    expect(path).toBe("/api/card/42/query");
    const body = z.object({ parameters: z.array(z.unknown()) }).parse(options?.body);
    expect(body.parameters).toEqual([
      { id: "p1", type: "category", target: ["variable", ["template-tag", "c"]], value: "Gizmo" },
    ]);
    return {
      status: "completed",
      row_count: 1,
      data: { rows: [["Gizmo"]], cols: [{ name: "category" }] },
    };
  };
  const { deps } = toolDeps(handler);
  const result = await runSavedQuestion(deps, {
    id: 42,
    parameters: [{ slug: "category", value: "Gizmo" }],
  });
  expect(result.details).toEqual({
    kind: "dataset",
    returned: 1,
    offset: 0,
    columns: [{ name: "category" }],
    rows: [["Gizmo"]],
    continuation: undefined,
  });
});

test("writes an export file to the working directory and counts csv rows", async () => {
  const cwd = await scratch();
  const csv = "category,total\nGizmo,10\nWidget,20\n";
  const handler: Responder = (path) => {
    expect(path).toBe("/api/card/42/query/csv");
    return csv;
  };
  const { deps } = toolDeps(handler, cwd);
  const result = await runSavedQuestion(deps, { id: 42, export: "csv" });
  expect(result.details).toEqual({
    kind: "json",
    label: `exported csv to ${join(cwd, "card-42.csv")}`,
    value: {
      path: join(cwd, "card-42.csv"),
      format: "csv",
      bytes: Buffer.byteLength(csv, "utf8"),
      row_count: 2,
    },
  });
  expect(await readFile(join(cwd, "card-42.csv"), "utf8")).toBe(csv);
});
