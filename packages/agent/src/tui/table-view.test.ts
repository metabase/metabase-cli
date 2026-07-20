import { hyperlink } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import type { TableData } from "../tools/table";
import { type DisplayTable, layoutTable } from "./table-view";

test("columns are padded to the widest cell they hold", () => {
  const table: TableData = {
    columns: ["id", "name"],
    rows: [
      ["1", "Orders"],
      ["2", "People"],
    ],
  };

  expect(layoutTable(table, 80)).toEqual({
    kind: "columns",
    header: ["id ", "name  "],
    rows: [
      [
        { text: "1  ", linked: false },
        { text: "Orders", linked: false },
      ],
      [
        { text: "2  ", linked: false },
        { text: "People", linked: false },
      ],
    ],
    widths: [3, 6],
  });
});

test("a terminal too narrow for the natural widths takes them from the widest column first", () => {
  const table: TableData = {
    columns: ["id", "name"],
    rows: [["1", "A name longer than the terminal has room for"]],
  };
  const layout = layoutTable(table, 20);

  expect(layout).toEqual({
    kind: "columns",
    header: ["id ", "name          "],
    rows: [
      [
        { text: "1  ", linked: false },
        { text: "A name longer…", linked: false },
      ],
    ],
    widths: [3, 14],
  });
});

test("a table with more columns than the terminal can align becomes one labelled block per row", () => {
  const columns = Array.from({ length: 40 }, (_, index) => `c${index}`);
  const table: TableData = { columns, rows: [columns.map((_, index) => String(index))] };
  const layout = layoutTable(table, 80);

  if (layout.kind !== "blocks") {
    throw new Error(`Expected a block layout, got ${layout.kind}.`);
  }
  expect(layout.rows).toHaveLength(1);
  expect(layout.rows[0]?.[0]).toEqual({ label: "c0 ", value: { text: "0", linked: false } });
  expect(layout.rows[0]?.[39]).toEqual({ label: "c39", value: { text: "39", linked: false } });
});

test("a linked cell pads to its column width without the escape sequence stealing columns", () => {
  const href = "https://mb.example.com/collection/18";
  const table: DisplayTable = {
    columns: ["id", "name"],
    rows: [["18", "Finance"]],
    hrefs: [[href, null]],
  };

  expect(layoutTable(table, 80)).toEqual({
    kind: "columns",
    header: ["id ", "name   "],
    rows: [
      [
        { text: `${hyperlink("18", href)} `, linked: true },
        { text: "Finance", linked: false },
      ],
    ],
    widths: [3, 7],
  });
});

test("a linked cell in a block layout is marked as one, so the theme can paint it as an address", () => {
  const href = "https://mb.example.com/question/236";
  const table: DisplayTable = {
    columns: ["id", "name"],
    rows: [["236", "Total Revenue"]],
    hrefs: [[href, href]],
  };
  const layout = layoutTable(table, 8);

  expect(layout).toEqual({
    kind: "blocks",
    rows: [
      [
        { label: "id  ", value: { text: hyperlink("236", href), linked: true } },
        { label: "name", value: { text: hyperlink("To…", href), linked: true } },
      ],
    ],
  });
});
