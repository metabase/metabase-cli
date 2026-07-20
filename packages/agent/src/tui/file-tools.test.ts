import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test } from "vitest";
import { fileToolRenderers, writeCallView } from "./file-tools";
import { GLYPH } from "./glyphs";

const CWD = "/work";

const MINIFIED =
  '{"lib/type":"mbql/query","database":2,"stages":[{"lib/type":"mbql.stage/mbql","source-table":180}]}';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-write-"));
  dirs.push(dir);
  return dir;
}

test("a query the model minified onto one line is indented into a body that can be capped", () => {
  expect(
    writeCallView({ path: "/work/.scratch/total-orders.mbql.json", content: MINIFIED }, CWD),
  ).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Write file",
      detail: ".scratch/total-orders.mbql.json",
      meta: ["10 lines"],
    },
    body: {
      language: "json",
      text: [
        "{",
        '  "lib/type": "mbql/query",',
        '  "database": 2,',
        '  "stages": [',
        "    {",
        '      "lib/type": "mbql.stage/mbql",',
        '      "source-table": 180',
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    },
  });
});

test("content that is not JSON is written through as it is", () => {
  expect(writeCallView({ path: ".scratch/revenue.sql", content: "SELECT 1\n" }, CWD)).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Write file",
      detail: ".scratch/revenue.sql",
      meta: ["2 lines"],
    },
    body: { language: "sql", text: "SELECT 1\n" },
  });
});

// Arguments stream: a header is drawn from a half-parsed object, long before `content` arrives.
test("a write whose arguments have not finished streaming is still a header", () => {
  expect(writeCallView({ path: ".scratch/x.json" }, CWD)).toEqual({
    line: { icon: GLYPH.write, title: "Write file", detail: ".scratch/x.json" },
  });
  expect(writeCallView({}, CWD)).toEqual({
    line: { icon: GLYPH.write, title: "Write file" },
  });
});

// The shadow is pi's own definition under pi's own name — replacing the builtin in the registry
// without replacing what it does. Everything but the two renderers comes from the builtin.
test("the shadow is pi's write tool, rendered by us", async () => {
  const cwd = await scratch();
  const builtin = createWriteToolDefinition(cwd);
  const [write] = fileToolRenderers(cwd);
  if (write === undefined) {
    throw new Error("fileToolRenderers renders the write tool");
  }

  expect(write.name).toBe(builtin.name);
  expect(write.description).toBe(builtin.description);
  expect(write.parameters).toBe(builtin.parameters);
  expect(write.renderCall).not.toBe(builtin.renderCall);
  expect(write.renderResult).not.toBe(builtin.renderResult);
});
