import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readMarkdownFiles } from "./markdown-files";

describe("readMarkdownFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mb-markdown-files-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads each Markdown file in the folder by its file name", async () => {
    writeFileSync(join(dir, "transform.md"), "Transform notes.\n");
    writeFileSync(join(dir, "auth.md"), "Auth notes.\n");
    writeFileSync(join(dir, "draft.txt"), "Not Markdown.\n");

    const files = await readMarkdownFiles(dir);

    expect(Object.fromEntries(files)).toEqual({
      "auth.md": "Auth notes.\n",
      "transform.md": "Transform notes.\n",
    });
  });

  it("reads a folder that does not exist as one with no files", async () => {
    const files = await readMarkdownFiles(join(dir, "missing"));

    expect(files).toEqual(new Map());
  });
});
