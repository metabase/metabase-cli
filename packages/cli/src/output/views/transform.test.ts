import { describe, expect, it } from "vitest";

import type { Transform } from "@metabase/client/domain/transform";

import { MALFORMED_CELL } from "../table";
import { transformView } from "./transform";

function renderCell(key: keyof Transform & string, value: unknown): string {
  const column = transformView.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`transformView declares no formatter for "${key}"`);
  }
  return column.format(value);
}

describe("transformView target cell", () => {
  it("renders a schema-qualified table target as schema.name", () => {
    expect(renderCell("target", { type: "table", schema: "public", name: "orders_daily" })).toBe(
      "public.orders_daily",
    );
  });

  it("renders a target carrying no schema as the bare table name", () => {
    expect(renderCell("target", { type: "table", schema: null, name: "orders_daily" })).toBe(
      "orders_daily",
    );
  });

  // A target type this Metabase writes and the CLI does not know misses the discriminated union.
  // Blanking the cell would read as "this transform writes nowhere".
  it("renders a target that fails its schema as the malformed marker", () => {
    expect(
      renderCell("target", { type: "materialized-view", schema: "public", name: "orders_daily" }),
    ).toBe(MALFORMED_CELL);
  });
});
