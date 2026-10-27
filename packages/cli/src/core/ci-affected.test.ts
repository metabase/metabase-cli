import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { InternalError, ValidationError } from "@metabase/client/errors";

import { parseYaml } from "../runtime/yaml";
import {
  type ClassifiedChange,
  type ContentFile,
  affectedTransforms,
  classifyContentFile,
  parseNameStatus,
  isContentPath,
  noContentChangesWarning,
  parseStatusPorcelain,
  uncommittedContentWarning,
} from "./ci-affected";

const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const OTHER_TRANSFORM_ID = "7XqqzlsonSq4KFyOvtrAm";

const TRANSFORM: ContentFile = {
  kind: "transform",
  entityId: TRANSFORM_ID,
  name: "Daily Order Summary",
  logic: { source: { type: "query" }, target: { name: "t" } },
};
const OTHER_TRANSFORM: ContentFile = {
  kind: "transform",
  entityId: OTHER_TRANSFORM_ID,
  name: "Hourly Stats",
  logic: { source: { type: "query" }, target: { name: "t" } },
};
const TEST: ContentFile = { kind: "transform-test", transformId: TRANSFORM_ID };
const OTHER: ContentFile = { kind: "other" };

const CHANGED_PATH = "transforms/t1/t1.yaml";

function change(base: ContentFile | null, head: ContentFile | null): ClassifiedChange {
  return { path: CHANGED_PATH, base, head };
}

const SINGLE_PATH_CASES = [
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["T", "modified"],
] as const;

function nul(...tokens: string[]): string {
  return tokens.map((token) => `${token}\0`).join("");
}

describe("parseNameStatus", () => {
  it("reads added, modified, deleted, type-changed, renamed and copied entries", () => {
    const output = nul(
      "A",
      "new.yaml",
      "M",
      "changed.yaml",
      "D",
      "gone.yaml",
      "T",
      "retyped.yaml",
      "R087",
      "old/name.yaml",
      "new/name.yaml",
      "C100",
      "source.yaml",
      "copy.yaml",
    );

    expect(parseNameStatus(output)).toEqual([
      { status: "added", path: "new.yaml" },
      { status: "modified", path: "changed.yaml" },
      { status: "deleted", path: "gone.yaml" },
      { status: "modified", path: "retyped.yaml" },
      { status: "renamed", path: "new/name.yaml", oldPath: "old/name.yaml" },
      { status: "added", path: "copy.yaml" },
    ]);
  });

  it("reads empty output as no changes", () => {
    expect(parseNameStatus("")).toEqual([]);
  });

  it("reads any sequence of entries git can emit, whatever the similarity score", () => {
    const path = fc.string({ minLength: 1 }).filter((text) => !text.includes("\0"));
    const score = fc.integer({ min: 0, max: 100 }).map((value) => String(value).padStart(3, "0"));
    const entry = fc.oneof(
      fc
        .tuple(fc.constantFrom(...SINGLE_PATH_CASES), path)
        .map(([[letter, status], entryPath]) => ({
          tokens: [letter, entryPath],
          expected: { status, path: entryPath },
        })),
      fc.tuple(score, path, path).map(([similarity, oldPath, newPath]) => ({
        tokens: [`R${similarity}`, oldPath, newPath],
        expected: { status: "renamed", path: newPath, oldPath },
      })),
      fc.tuple(score, path, path).map(([similarity, source, copy]) => ({
        tokens: [`C${similarity}`, source, copy],
        expected: { status: "added", path: copy },
      })),
    );

    fc.assert(
      fc.property(fc.array(entry), (entries) => {
        const output = nul(...entries.flatMap((generated) => generated.tokens));
        expect(parseNameStatus(output)).toEqual(entries.map((generated) => generated.expected));
      }),
    );
  });

  it("refuses a status letter outside A, M, D, T, R and C", () => {
    const parse = () => parseNameStatus(nul("X", "odd.yaml"));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: unexpected status "X"');
  });

  it("refuses a rename missing its destination path", () => {
    const parse = () => parseNameStatus(nul("R100", "old.yaml"));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: missing a path for status "R100"');
  });

  it("refuses output cut off before its final NUL", () => {
    const parse = () => parseNameStatus("M\0a.yaml\0D");

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow("git diff --name-status -z: truncated: the output does not end in a NUL");
  });

  it("accepts the scored modification that git prints with -B", () => {
    expect(parseNameStatus(nul("M100", "a.yaml"))).toEqual([
      { status: "modified", path: "a.yaml" },
    ]);
  });

  it("refuses a status letter followed by a non-digit", () => {
    const parse = () => parseNameStatus(nul("MX", "a.yaml"));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: unexpected status "MX"');
  });

  it("refuses a rename without a similarity score", () => {
    const parse = () => parseNameStatus(nul("R", "old.yaml", "new.yaml"));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: unexpected status "R"');
  });

  it("refuses a copy whose source path is empty", () => {
    const parse = () => parseNameStatus(nul("C100", "", "copy.yaml"));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: missing a path for status "C100"');
  });

  it("refuses an empty path", () => {
    const parse = () => parseNameStatus(nul("A", ""));

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git diff --name-status -z: missing a path for status "A"');
  });
});

describe("classifyContentFile", () => {
  it("classifies a transform by the last serdes/meta model", () => {
    expect(
      classifyContentFile("transforms/a.yaml", {
        entity_id: TRANSFORM_ID,
        name: "Daily Order Summary",
        source: { type: "query" },
        target: { name: "t" },
        "serdes/meta": [{ model: "Transform" }],
      }),
    ).toEqual(TRANSFORM);
  });

  it("classifies a transform test by the transform it covers", () => {
    expect(
      classifyContentFile("transforms/a/t.yaml", {
        transform_id: TRANSFORM_ID,
        "serdes/meta": [{ model: "Transform" }, { model: "TransformTest" }],
      }),
    ).toEqual(TEST);
  });

  it("classifies a transform test in the exported one-entry serdes/meta shape", () => {
    expect(
      classifyContentFile("transforms/t1/t.yaml", {
        transform_id: TRANSFORM_ID,
        "serdes/meta": [{ model: "TransformTest" }],
      }),
    ).toEqual(TEST);
  });

  it("classifies any other serialized model as other", () => {
    expect(
      classifyContentFile("collections/c.yaml", { "serdes/meta": [{ model: "Collection" }] }),
    ).toEqual(OTHER);
  });

  it("classifies a document without serdes/meta as other", () => {
    expect(classifyContentFile("settings.yaml", { "report-timezone": "UTC" })).toEqual(OTHER);
  });

  it("refuses a malformed serdes/meta rather than ignoring the file", () => {
    const classify = () => classifyContentFile("transforms/a.yaml", { "serdes/meta": [] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: serdes/meta must be a non-empty list of entries with a model",
    );
  });

  it("refuses a serdes/meta entry without a model", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", { "serdes/meta": [{ id: TRANSFORM_ID }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: serdes/meta must be a non-empty list of entries with a model",
    );
  });

  it("refuses a serdes/meta entry whose model is not a string", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", { "serdes/meta": [{ model: null }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: serdes/meta must be a non-empty list of entries with a model",
    );
  });

  it("refuses a serdes/meta entry that is not a map", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", { "serdes/meta": ["Transform"] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: serdes/meta must be a non-empty list of entries with a model",
    );
  });

  it("refuses a transform test without the transform it covers", () => {
    const classify = () =>
      classifyContentFile("transforms/a/t.yaml", { "serdes/meta": [{ model: "TransformTest" }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow("transforms/a/t.yaml: a TransformTest must name its transform_id");
  });

  it("refuses a transform test whose transform_id is empty", () => {
    const classify = () =>
      classifyContentFile("transforms/a/t.yaml", {
        transform_id: "",
        "serdes/meta": [{ model: "TransformTest" }],
      });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow("transforms/a/t.yaml: a TransformTest must name its transform_id");
  });

  it("refuses a transform without an entity_id", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", { "serdes/meta": [{ model: "Transform" }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: a Transform must have an entity_id, a name, a source and a target",
    );
  });

  it("refuses a transform whose entity_id is empty", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", {
        entity_id: "",
        "serdes/meta": [{ model: "Transform" }],
      });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow(
      "transforms/a.yaml: a Transform must have an entity_id, a name, a source and a target",
    );
  });
});

describe("affectedTransforms", () => {
  it("includes a transform present only at head", () => {
    expect(affectedTransforms([change(null, TRANSFORM)])).toEqual([TRANSFORM_ID]);
  });

  it("includes a transform changed in place", () => {
    expect(affectedTransforms([change(TRANSFORM, TRANSFORM)])).toEqual([TRANSFORM_ID]);
  });

  it("includes the covered transform when only its test changed", () => {
    expect(affectedTransforms([change(TEST, TEST)])).toEqual([TRANSFORM_ID]);
  });

  it("includes the covered transform when its test was deleted", () => {
    expect(affectedTransforms([change(TEST, null)])).toEqual([TRANSFORM_ID]);
  });

  it("includes both transforms when a test moves from one transform to another", () => {
    const moved: ContentFile = { kind: "transform-test", transformId: OTHER_TRANSFORM_ID };

    expect(affectedTransforms([change(TEST, moved)])).toEqual([TRANSFORM_ID, OTHER_TRANSFORM_ID]);
  });

  it("drops a deleted transform along with the tests deleted with it", () => {
    expect(affectedTransforms([change(TRANSFORM, null), change(TEST, null)])).toEqual([]);
  });

  it("keeps a transform that a rename split into a deletion and an addition", () => {
    expect(affectedTransforms([change(TRANSFORM, null), change(null, TRANSFORM)])).toEqual([
      TRANSFORM_ID,
    ]);
  });

  it("treats a file whose entity_id changed as one transform removed and another added", () => {
    expect(affectedTransforms([change(TRANSFORM, OTHER_TRANSFORM)])).toEqual([OTHER_TRANSFORM_ID]);
  });

  it("drops an edited test whose transform is gone at head", () => {
    expect(affectedTransforms([change(TRANSFORM, null), change(TEST, TEST)])).toEqual([]);
  });

  it("lists a transform once however many of its files changed", () => {
    expect(
      affectedTransforms([change(TRANSFORM, TRANSFORM), change(TEST, TEST), change(null, TEST)]),
    ).toEqual([TRANSFORM_ID]);
  });

  it("ignores files that are neither transforms nor transform tests", () => {
    expect(affectedTransforms([change(OTHER, OTHER)])).toEqual([]);
  });

  it("refuses a transform whose file no longer reads as content at head", () => {
    const affected = () => affectedTransforms([change(TRANSFORM, OTHER)]);

    expect(affected).toThrow(ValidationError);
    expect(affected).toThrow(
      `${CHANGED_PATH}: a Transform or TransformTest at base no longer reads as one at head`,
    );
  });

  it("refuses a transform test whose file no longer reads as content at head", () => {
    const affected = () => affectedTransforms([change(TEST, OTHER)]);

    expect(affected).toThrow(ValidationError);
    expect(affected).toThrow(
      `${CHANGED_PATH}: a Transform or TransformTest at base no longer reads as one at head`,
    );
  });

  it("refuses a transform whose identity moved under a YAML merge key", () => {
    const merged = parseYaml(
      `<<: {serdes/meta: [{model: Transform}], entity_id: ${TRANSFORM_ID}}\nname: t1\n`,
      z.unknown(),
    );
    const affected = () =>
      affectedTransforms([change(TRANSFORM, classifyContentFile(CHANGED_PATH, merged))]);

    expect(affected).toThrow(ValidationError);
    expect(affected).toThrow(
      `${CHANGED_PATH}: a Transform or TransformTest at base no longer reads as one at head`,
    );
  });
});

describe("parseStatusPorcelain", () => {
  it("lists modified, renamed and untracked paths, skipping a rename's source", () => {
    expect(parseStatusPorcelain(" M a.yaml\0R  c.yaml\0b.yaml\0?? new.yaml\0")).toEqual([
      "a.yaml",
      "c.yaml",
      "new.yaml",
    ]);
  });

  it("reads a clean tree as no paths", () => {
    expect(parseStatusPorcelain("")).toEqual([]);
  });

  it("skips a copy's source path", () => {
    expect(parseStatusPorcelain("C  copy.yaml\0orig.yaml\0?? new.yaml\0")).toEqual([
      "copy.yaml",
      "new.yaml",
    ]);
  });

  it("refuses an entry whose status is not followed by a space", () => {
    const parse = () => parseStatusPorcelain("MMa.yaml\0");

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git status --porcelain -z: malformed entry "MMa.yaml"');
  });

  it("refuses an entry without the status and space prefix", () => {
    const parse = () => parseStatusPorcelain("M\0");

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow('git status --porcelain -z: malformed entry "M"');
  });

  it("refuses output cut off before its final NUL", () => {
    const parse = () => parseStatusPorcelain(" M a.yaml");

    expect(parse).toThrow(InternalError);
    expect(parse).toThrow("git status --porcelain -z: truncated: the output does not end in a NUL");
  });
});

describe("isContentPath", () => {
  it("accepts a .yaml file under a Metabase content folder", () => {
    expect(
      [
        "transforms/a.yaml",
        "collections/x/cards/b.yaml",
        "python-libraries/c.yaml",
        "data_apps/app/data_app.yaml",
      ].map(isContentPath),
    ).toEqual([true, true, true, true]);
  });

  it("refuses what Metabase's import does not read as an entity file", () => {
    expect(
      [
        "a.yaml",
        "transforms/b.yml",
        "transforms/c.json",
        "transforms/d.yaml.bak",
        "transforms/.e.yaml",
        ".github/workflows/ci.yaml",
        "docs/examples/f.yaml",
        "data_apps/app/src/g.yaml",
        "Transforms/h.yaml",
      ].map(isContentPath),
    ).toEqual([false, false, false, false, false, false, false, false, false]);
  });
});

describe("noContentChangesWarning", () => {
  it("warns when no changed path is a content file", () => {
    expect(
      noContentChangesWarning([
        { status: "modified", path: "README.md" },
        { status: "added", path: "docs/daily.yaml" },
      ]),
    ).toEqual({
      code: "no-content-changes",
      message: "the change touches no Metabase content files, so CI checked nothing",
    });
  });

  it("warns on an empty diff", () => {
    expect(noContentChangesWarning([])).toEqual({
      code: "no-content-changes",
      message: "the change touches no Metabase content files, so CI checked nothing",
    });
  });

  it("does not warn when a content file changed", () => {
    expect(noContentChangesWarning([{ status: "deleted", path: CHANGED_PATH }])).toBeNull();
  });

  it("does not warn when a content file was renamed out of the content folders", () => {
    expect(
      noContentChangesWarning([
        { status: "renamed", path: "archive/t1.yaml", oldPath: CHANGED_PATH },
      ]),
    ).toBeNull();
  });
});

describe("uncommittedContentWarning", () => {
  it("names one uncommitted content file", () => {
    expect(
      uncommittedContentWarning(["transforms/a.yaml", "notes.txt", ".github/ci.yaml"]),
    ).toEqual({
      code: "uncommitted-content",
      message:
        "1 content file has uncommitted changes, which CI does not see; it checks the committed version: transforms/a.yaml",
    });
  });

  it("counts several uncommitted content files", () => {
    expect(uncommittedContentWarning(["transforms/a.yaml", "collections/b.yaml"])).toEqual({
      code: "uncommitted-content",
      message:
        "2 content files have uncommitted changes, which CI does not see; it checks the committed version: transforms/a.yaml, collections/b.yaml",
    });
  });

  it("says nothing when no content file is uncommitted", () => {
    expect(uncommittedContentWarning(["notes.txt"])).toBeNull();
  });
});
