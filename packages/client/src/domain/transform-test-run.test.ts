import { describe, expect, it } from "vitest";

import { TestRunInput, TestRunInputCompact } from "./transform-test-run";

describe("TestRunInput", () => {
  const base = {
    table_id: 229,
    schema: "public",
    name: "orders",
    columns: ["id", "total"],
  };

  it("accepts a schema-qualified input table", () => {
    expect(TestRunInput.safeParse(base).success).toBe(true);
  });

  it("accepts a null schema (engines without schemas)", () => {
    const parsed = TestRunInput.safeParse({ ...base, schema: null });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.schema).toBeNull();
  });

  it("rejects a missing schema key", () => {
    const { schema: _schema, ...rest } = base;
    expect(TestRunInput.safeParse(rest).success).toBe(false);
  });

  it("compact pick preserves a null schema", () => {
    expect(TestRunInputCompact.parse({ ...base, schema: null }).schema).toBeNull();
  });
});
