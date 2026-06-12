import { assert, describe, expect, it } from "vitest";

import type { ColumnDef } from "../domain/view";
import { ANSI_ESC } from "./help";
import { renderTable } from "./table";

interface Row {
  id: number;
  name: string;
  archived: boolean | null;
}

const columns: ColumnDef<Row>[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "archived", label: "Archived" },
];

const ANSI_PATTERN = new RegExp(`${ANSI_ESC}\\[[0-9;]*m`, "g");

function rowCells(rendered: string, marker: string): string[] {
  const stripped = rendered.replace(ANSI_PATTERN, "");
  const line = stripped.split("\n").find((row) => row.includes(marker));
  assert(line !== undefined, `row containing "${marker}" not found`);
  return line
    .split("│")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

describe("renderTable", () => {
  it("renders headers from labels and one row per input", () => {
    const out = renderTable(
      [
        { id: 1, name: "Sales", archived: false },
        { id: 2, name: "Ops", archived: true },
      ],
      columns,
    );
    expect(rowCells(out, "ID")).toEqual(["ID", "Name", "Archived"]);
    expect(rowCells(out, "Sales")).toEqual(["1", "Sales", "false"]);
    expect(rowCells(out, "Ops")).toEqual(["2", "Ops", "true"]);
  });

  it("falls back to key when label is omitted", () => {
    const out = renderTable<Row>(
      [{ id: 1, name: "Sales", archived: false }],
      [{ key: "id" }, { key: "name" }, { key: "archived" }],
    );
    expect(rowCells(out, "id")).toEqual(["id", "name", "archived"]);
  });

  it("renders null cells as blank (no 'null' literal)", () => {
    const out = renderTable([{ id: 1, name: "Sales", archived: null }], columns);
    expect(rowCells(out, "Sales")).toEqual(["1", "Sales", ""]);
  });

  it("uses a custom format function when provided", () => {
    const out = renderTable<Row>(
      [{ id: 1, name: "Sales", archived: true }],
      [
        { key: "id" },
        { key: "archived", label: "State", format: (value) => (value === true ? "yes" : "no") },
      ],
    );
    expect(rowCells(out, "yes")).toEqual(["1", "yes"]);
  });
});
