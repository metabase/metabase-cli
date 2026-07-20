import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, expect, test } from "vitest";
import { displayTableFromRecords } from "../tools/table";
import { createLinker, type Linker } from "./link";
import { linkTable } from "./result-view";

const BASE = "https://mb.example.com";

const before = getCapabilities();

afterEach(() => {
  setCapabilities(before);
});

function linking(): Linker {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  return createLinker(BASE);
}

interface SearchRow {
  id: number;
  model: string;
  name: string;
  collection_id: number;
}

test("a searched row addresses itself by id and name, and the collection it lives in", () => {
  const rows: SearchRow[] = [
    { id: 42, model: "card", name: "Recent Orders", collection_id: 18 },
    { id: 7, model: "dashboard", name: "Ops", collection_id: 18 },
  ];
  const table = displayTableFromRecords(rows);
  if (table === null) {
    throw new Error("records tabulate");
  }

  expect(linkTable(table, rows, "results", linking())).toEqual({
    columns: ["id", "model", "name", "collection_id"],
    rows: [
      ["42", "card", "Recent Orders", "18"],
      ["7", "dashboard", "Ops", "18"],
    ],
    hrefs: [
      [`${BASE}/question/42`, null, `${BASE}/question/42`, `${BASE}/collection/18`],
      [`${BASE}/dashboard/7`, null, `${BASE}/dashboard/7`, `${BASE}/collection/18`],
    ],
  });
});

interface TableRow {
  id: number;
  name: string;
  db_id: number;
}

// A listing of tables says what its rows are in its noun; the rows themselves carry no `model`.
test("a listing whose rows do not name their kind is addressed through its noun", () => {
  const rows: TableRow[] = [{ id: 180, name: "orders", db_id: 2 }];
  const table = displayTableFromRecords(rows);
  if (table === null) {
    throw new Error("records tabulate");
  }

  expect(linkTable(table, rows, "tables", linking()).hrefs).toEqual([
    [
      `${BASE}/question#?db=2&table=180`,
      `${BASE}/question#?db=2&table=180`,
      `${BASE}/browse/databases/2`,
    ],
  ]);
});

test("a row of a kind with no page in the instance stays text", () => {
  const rows = [{ id: 3, name: "revenue_cte" }];
  const table = displayTableFromRecords(rows);
  if (table === null) {
    throw new Error("records tabulate");
  }

  expect(linkTable(table, rows, "snippets", linking()).hrefs).toEqual([[null, null]]);
});
