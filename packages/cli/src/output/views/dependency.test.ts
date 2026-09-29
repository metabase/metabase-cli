import { describe, expect, it } from "vitest";

import { renderTable } from "../table";
import type { ColumnDef, ResourceView } from "../view";
import { breakingSourceView, dependencyGraphView, dependencyNodeView } from "./dependency";

const ORDERS_TABLE = {
  id: 12,
  type: "table",
  data: {
    name: "orders",
    display_name: "Orders",
    db_id: 1,
    db: { id: 1, name: "Warehouse" },
    schema: "public",
  },
  dependents_count: { question: 2, model: 1 },
} as const;

const REVENUE_CARD = {
  id: 5,
  type: "card",
  data: {
    name: "Revenue",
    type: "question",
    collection: { id: 3, name: "Finance", authority_level: null, is_personal: false },
  },
  dependents_count: null,
} as const;

const SANDBOX = { id: 9, type: "sandbox", data: { table_id: 12 }, dependents_count: null } as const;

interface NodeRow {
  ID: string;
  Type: string;
  Name: string;
  Location: string;
  Dependents: string;
}

const NODE_ROW_COLUMNS: ColumnDef<NodeRow>[] = [
  { key: "ID" },
  { key: "Type" },
  { key: "Name" },
  { key: "Location" },
  { key: "Dependents" },
];

function formatterOf<T>(view: ResourceView<T>, key: keyof T & string): (value: unknown) => string {
  const column = view.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`view declares no formatter for "${key}"`);
  }
  return column.format;
}

describe("dependencyNodeView table", () => {
  it("names a table by its display name and places it by database, a card by name and collection", () => {
    expect(renderTable([ORDERS_TABLE, REVENUE_CARD], dependencyNodeView.tableColumns)).toBe(
      renderTable(
        [
          {
            ID: "12",
            Type: "table",
            Name: "Orders",
            Location: "Warehouse",
            Dependents: "question: 2, model: 1",
          },
          { ID: "5", Type: "card", Name: "Revenue", Location: "Finance", Dependents: "" },
        ],
        NODE_ROW_COLUMNS,
      ),
    );
  });

  it("places a card saved inside a dashboard by that dashboard, not its collection", () => {
    const dashboardQuestion = {
      ...REVENUE_CARD,
      data: { ...REVENUE_CARD.data, dashboard: { id: 4, name: "Finance overview" } },
    };
    expect(renderTable([dashboardQuestion], dependencyNodeView.tableColumns)).toBe(
      renderTable(
        [{ ID: "5", Type: "card", Name: "Revenue", Location: "Finance overview", Dependents: "" }],
        NODE_ROW_COLUMNS,
      ),
    );
  });

  it("renders a sandbox, which has no name or location, with blank cells", () => {
    expect(renderTable([SANDBOX], dependencyNodeView.tableColumns)).toBe(
      renderTable(
        [{ ID: "9", Type: "sandbox", Name: "", Location: "", Dependents: "" }],
        NODE_ROW_COLUMNS,
      ),
    );
  });
});

describe("breakingSourceView errors cell", () => {
  it("names each broken dependent with its error type", () => {
    expect(
      formatterOf(
        breakingSourceView,
        "dependents_errors",
      )([
        {
          id: 1,
          analyzed_entity_type: "card",
          analyzed_entity_id: 7,
          error_type: "missing-column",
          error_detail: "TOTAL",
          source_entity_type: "table",
          source_entity_id: 12,
        },
        {
          id: 2,
          analyzed_entity_type: "transform",
          analyzed_entity_id: 3,
          error_type: "syntax-error",
        },
      ]),
    ).toBe("card 7: missing-column; transform 3: syntax-error");
  });
});

describe("dependencyGraphView cells", () => {
  it("lists nodes on one line as kind, id and name", () => {
    expect(formatterOf(dependencyGraphView, "nodes")([REVENUE_CARD, ORDERS_TABLE, SANDBOX])).toBe(
      "card 5 Revenue; table 12 Orders; sandbox 9",
    );
  });

  it("draws an edge as an arrow from the dependent to what it depends on", () => {
    expect(
      formatterOf(
        dependencyGraphView,
        "edges",
      )([
        { from_entity_type: "card", from_entity_id: 5, to_entity_type: "table", to_entity_id: 12 },
      ]),
    ).toBe("card 5 -> table 12");
  });
});
