import { describe, expect, it } from "vitest";

import {
  TransformTest,
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
