import { describe, expect, it } from "vitest";

import {
  TransformTest,
  TransformTestAdhocRunInput,
  TransformTestCreateInput,
  TransformTestUpdateInput,
} from "./transform-test";

const STORED = {
  id: 3,
  entity_id: "AbCdEfGhIjKlMnOpQrStU",
  transform_id: 7,
  creator_id: 1,
  name: "people summary holds one row",
  description: null,
  inputs: [{ table: { schema: "public", name: "people" }, format: "sql", sql: "SELECT 1 AS id" }],
  expectations: [{ type: "empty", name: "no null ids", sql: "SELECT * FROM out" }],
  created_at: "2026-09-15T12:00:00Z",
  updated_at: "2026-09-15T12:00:00Z",
};

const READ_ONLY_KEYS = ["id", "entity_id", "creator_id", "created_at", "updated_at"] as const;

function withoutReadOnlyKeys(stored: TransformTest): Record<string, unknown> {
  const body: Record<string, unknown> = { ...stored };
  for (const key of READ_ONLY_KEYS) {
    delete body[key];
  }
  return body;
}

describe("TransformTestCreateInput", () => {
  it("names the read-only keys a body cloned from a stored test still carries", () => {
    const result = TransformTestCreateInput.safeParse(TransformTest.parse(STORED));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        code: "unrecognized_keys",
        keys: [...READ_ONLY_KEYS],
        path: [],
        message: 'Unrecognized keys: "id", "entity_id", "creator_id", "created_at", "updated_at"',
      },
    ]);
  });

  it("accepts that same body once those keys are stripped", () => {
    const body = withoutReadOnlyKeys(TransformTest.parse(STORED));

    expect(TransformTestCreateInput.parse(body)).toEqual({
      transform_id: 7,
      name: "people summary holds one row",
      description: null,
      inputs: [
        { table: { schema: "public", name: "people" }, format: "sql", sql: "SELECT 1 AS id" },
      ],
      expectations: [{ type: "empty", name: "no null ids", sql: "SELECT * FROM out" }],
    });
  });
});

describe("TransformTestUpdateInput", () => {
  it("names a read-only key rather than sending it for the server to refuse", () => {
    const result = TransformTestUpdateInput.safeParse({ id: 3, name: "renamed" });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        code: "unrecognized_keys",
        keys: ["id"],
        path: [],
        message: 'Unrecognized key: "id"',
      },
    ]);
  });

  it("patches a single field", () => {
    expect(TransformTestUpdateInput.parse({ name: "renamed" })).toEqual({ name: "renamed" });
  });
});

const ADHOC_RUN = {
  transform: {
    name: "people summary",
    source: {
      type: "query",
      query: { database: 1, type: "native", native: { query: "SELECT 1" } },
    },
    target: { type: "table", database: 1, schema: "public", name: "people_summary" },
  },
  test: {
    name: "people summary holds one row",
    inputs: STORED.inputs,
    expectations: STORED.expectations,
  },
};

describe("TransformTestAdhocRunInput", () => {
  it("names a create-only key on the transform", () => {
    const result = TransformTestAdhocRunInput.safeParse({
      ...ADHOC_RUN,
      transform: { ...ADHOC_RUN.transform, run_trigger: "none" },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        code: "unrecognized_keys",
        keys: ["run_trigger"],
        path: ["transform"],
        message: 'Unrecognized key: "run_trigger"',
      },
    ]);
  });

  it("names the transform id a saved test carries", () => {
    const result = TransformTestAdhocRunInput.safeParse({
      ...ADHOC_RUN,
      test: { ...ADHOC_RUN.test, transform_id: 7 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      {
        code: "unrecognized_keys",
        keys: ["transform_id"],
        path: ["test"],
        message: 'Unrecognized key: "transform_id"',
      },
    ]);
  });
});
