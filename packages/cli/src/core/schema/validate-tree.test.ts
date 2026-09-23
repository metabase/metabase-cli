import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { validateTree } from "./validate-tree";

const COLLECTION_YAML = `name: Minimal
entity_id: cOlMiNiMaL000ExAmPlx2
serdes/meta:
  - id: cOlMiNiMaL000ExAmPlx2
    model: Collection
`;

describe("validateTree", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mb-validate-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(relPath: string, content: string): void {
    const full = join(root, ...relPath.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  it("walks the import roots that exist when no path is given and reports each file", async () => {
    write("collections/main/minimal.yaml", COLLECTION_YAML);
    write("transforms/transform_tags/nightly.yaml", "name: nightly\n");
    write("notes/readme.yaml", "ignored: true\n");

    expect(await validateTree([], root)).toEqual({
      ok: false,
      checked: 2,
      passed: 1,
      failed: 1,
      results: [
        { file: "collections/main/minimal.yaml", model: "Collection", ok: true, errors: [] },
        {
          file: "transforms/transform_tags/nightly.yaml",
          model: null,
          ok: false,
          errors: [{ path: "/", message: "missing serdes/meta, so no schema applies" }],
        },
      ],
    });
  });

  it("checks the files and directories named, relative to the working directory", async () => {
    write("collections/main/minimal.yaml", COLLECTION_YAML);
    write("elsewhere/card.yaml", "serdes/meta:\n  - id: x\n    model: Widget\n");

    const report = await validateTree(["collections", "elsewhere/card.yaml"], root);

    expect(report.results).toEqual([
      { file: "collections/main/minimal.yaml", model: "Collection", ok: true, errors: [] },
      {
        file: "elsewhere/card.yaml",
        model: "Widget",
        ok: false,
        errors: [{ path: "/", message: 'unknown serdes/meta model "Widget"' }],
      },
    ]);
  });

  it("reports unparseable YAML as an error at the root pointer", async () => {
    write("collections/broken.yaml", "name: [\n");

    const report = await validateTree(["collections/broken.yaml"], root);

    expect(report.results).toEqual([
      {
        file: "collections/broken.yaml",
        model: null,
        ok: false,
        errors: [
          {
            path: "/",
            message:
              "collections/broken.yaml: invalid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1:\n\nname: [\n\n^\n",
          },
        ],
      },
    ]);
  });

  it("refuses a path that does not exist", async () => {
    await expect(validateTree(["missing.yaml"], root)).rejects.toThrow(
      new ConfigError(`${join(root, "missing.yaml")} does not exist`),
    );
  });

  it("reports nothing to check when no import root exists", async () => {
    expect(await validateTree([], root)).toEqual({
      ok: true,
      checked: 0,
      passed: 0,
      failed: 0,
      results: [],
    });
  });
});
