import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { InternalError, ValidationError } from "@metabase/client/errors";

import {
  type ClassifiedChange,
  type ContentFile,
  affectedTransforms,
  classifyContentFile,
  parseNameStatus,
} from "./ci-affected";

const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const OTHER_TRANSFORM_ID = "7XqqzlsonSq4KFyOvtrAm";

const TRANSFORM: ContentFile = { kind: "transform", entityId: TRANSFORM_ID };
const OTHER_TRANSFORM: ContentFile = { kind: "transform", entityId: OTHER_TRANSFORM_ID };
const TEST: ContentFile = { kind: "transform-test", transformId: TRANSFORM_ID };
const OTHER: ContentFile = { kind: "other" };

function change(base: ContentFile | null, head: ContentFile | null): ClassifiedChange {
  return { base, head };
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

  it("refuses a transform test without the transform it covers", () => {
    const classify = () =>
      classifyContentFile("transforms/a/t.yaml", { "serdes/meta": [{ model: "TransformTest" }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow("transforms/a/t.yaml: a TransformTest must name its transform_id");
  });

  it("refuses a transform without an entity_id", () => {
    const classify = () =>
      classifyContentFile("transforms/a.yaml", { "serdes/meta": [{ model: "Transform" }] });

    expect(classify).toThrow(ValidationError);
    expect(classify).toThrow("transforms/a.yaml: a Transform must name its entity_id");
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
    expect(affectedTransforms([change(TRANSFORM, OTHER_TRANSFORM), change(TEST, TEST)])).toEqual([
      OTHER_TRANSFORM_ID,
    ]);
  });

  it("lists a transform once however many of its files changed", () => {
    expect(
      affectedTransforms([change(TRANSFORM, TRANSFORM), change(TEST, TEST), change(null, TEST)]),
    ).toEqual([TRANSFORM_ID]);
  });

  it("ignores files that are neither transforms nor transform tests", () => {
    expect(affectedTransforms([change(OTHER, OTHER)])).toEqual([]);
  });
});
