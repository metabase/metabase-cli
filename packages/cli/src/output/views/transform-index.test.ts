import { describe, expect, it } from "vitest";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";
import { transformIndexRequestView, transformIndexView } from "./transform-index";

function renderCell<T>(view: ResourceView<T>, key: keyof T & string, value: unknown): string {
  const column = view.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`the view declares no formatter for "${key}"`);
  }
  return column.format(value);
}

describe("transformIndexRequestView definition cell", () => {
  it("renders a column-carrying definition as kind(columns)", () => {
    expect(
      renderCell(transformIndexRequestView, "structured", {
        kind: "btree",
        name: "idx_id",
        columns: [{ name: "id" }, { name: "created_at" }],
      }),
    ).toBe("btree(id, created_at)");
  });

  it("renders a definition that names no columns as the bare kind", () => {
    expect(
      renderCell(transformIndexRequestView, "structured", { kind: "distkey", style: "even" }),
    ).toBe("distkey");
  });

  // An index kind this Metabase writes and the CLI does not know misses the discriminated union.
  // Blanking the cell would read as "this request declares nothing".
  it("renders a definition that fails its schema as the malformed marker", () => {
    expect(
      renderCell(transformIndexRequestView, "structured", {
        kind: "zorder",
        columns: [{ name: "id" }],
      }),
    ).toBe(MALFORMED_CELL);
  });
});

describe("transformIndexView cells", () => {
  it("renders the key columns as a comma-separated list", () => {
    expect(renderCell(transformIndexView, "key_columns", ["id", "created_at"])).toBe(
      "id, created_at",
    );
  });

  it("renders a managed request as its id and status", () => {
    expect(
      renderCell(transformIndexView, "request", {
        id: 3,
        transform_id: 1,
        index_name: "idx_id",
        status: "create-pending",
        structured: { kind: "btree", name: "idx_id", columns: [{ name: "id" }] },
        error_message: null,
      }),
    ).toBe("#3 create-pending");
  });

  it("renders an index Metabase does not manage as an empty request cell", () => {
    expect(renderCell(transformIndexView, "request", undefined)).toBe("");
  });

  it("renders a request that fails its schema as the malformed marker", () => {
    expect(renderCell(transformIndexView, "request", { id: 3, status: "invented-status" })).toBe(
      MALFORMED_CELL,
    );
  });
});
