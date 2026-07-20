import { expect, test } from "vitest";
import {
  cellText,
  displayTableFromRecords,
  formatModelTable,
  sqlCellText,
  tableFromRecords,
} from "./table";

test("the model table pays for column names once and pads nothing", () => {
  const table = tableFromRecords([
    { id: 1, name: "Orders", description: "Every order ever placed in the store" },
    { id: 2, name: "People", description: null },
  ]);
  expect(table).toEqual({
    columns: ["id", "name", "description"],
    rows: [
      ["1", "Orders", "Every order ever placed in the store"],
      ["2", "People", ""],
    ],
  });
  expect(formatModelTable({ columns: ["id", "name"], rows: [["1", "Orders"]] })).toBe(
    "id | name\n1 | Orders",
  );
});

test("records missing a key still line up under the union of columns", () => {
  expect(tableFromRecords([{ id: 1 }, { name: "Orders" }])).toEqual({
    columns: ["id", "name"],
    rows: [
      ["1", ""],
      ["", "Orders"],
    ],
  });
});

test("a non-record item rejects the projection so the caller can fall back to JSON", () => {
  expect(tableFromRecords(["Public", "internal"])).toBe(null);
  expect(tableFromRecords([])).toBe(null);
});

test("cells stay on one line and never forge a column boundary", () => {
  expect(cellText("a\nb")).toBe("a\\nb");
  expect(cellText("Revenue | Net")).toBe("Revenue \\| Net");
  expect(cellText({ nested: true })).toBe('{"nested":true}');
  expect(cellText(null)).toBe("");
});

test("a SQL NULL is distinguishable from an empty string, unlike an absent field", () => {
  expect(sqlCellText(null)).toBe("NULL");
  expect(sqlCellText("")).toBe("");
});

test("a nested entity in a display cell is named, not dumped as JSON the reader must parse", () => {
  const records = [{ id: 1, collection: { id: 5, name: "Finance", authority_level: null } }];

  expect(displayTableFromRecords(records)).toEqual({
    columns: ["id", "collection"],
    rows: [["1", "Finance"]],
  });
});

test("the root collection names itself with a null, and reads as an empty cell", () => {
  const records = [{ collection: { id: null, name: null } }];

  expect(displayTableFromRecords(records)).toEqual({ columns: ["collection"], rows: [[""]] });
});

test("the model still receives the whole nested entity, because it may need the id", () => {
  const records = [{ collection: { id: 5, name: "Finance" } }];

  expect(tableFromRecords(records)).toEqual({
    columns: ["collection"],
    rows: [['{"id":5,"name":"Finance"}']],
  });
});
