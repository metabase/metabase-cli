import { describe, expect, it } from "vitest";

import type { QueryMetadata } from "@metabase/client/domain/dataset";

import { MALFORMED_CELL } from "../table";
import { queryMetadataView } from "./dataset";

function renderCell(key: keyof QueryMetadata & string, value: unknown): string {
  const column = queryMetadataView.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`queryMetadataView declares no formatter for "${key}"`);
  }
  return column.format(value);
}

describe("queryMetadataView cells", () => {
  it("renders a real table and a virtual table by display name in one list", () => {
    expect(
      renderCell("tables", [
        { id: 7, display_name: "Orders", name: "orders" },
        { id: "card__3", display_name: "Orders by status" },
      ]),
    ).toBe("Orders, Orders by status");
  });

  it("renders an empty list as a blank cell", () => {
    expect(renderCell("snippets", [])).toBe("");
  });

  it("renders a list whose item lacks its name as the malformed marker", () => {
    expect(renderCell("databases", [{ id: 1 }])).toBe(MALFORMED_CELL);
  });
});
