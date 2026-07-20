import { expect, test } from "vitest";
import { buildListEnvelope } from "./envelope";
import { isToolPayload, payloadText } from "./payload";

test("a list renders as one header row plus one line per record, then a count", () => {
  const envelope = buildListEnvelope(
    [
      { id: 1, name: "Orders", model: "card" },
      { id: 2, name: "Revenue", model: "dashboard" },
    ],
    { total: 2, steering: { noun: "results" } },
  );
  expect(payloadText({ kind: "list", noun: "results", envelope })).toBe(
    [
      "id | name | model",
      "1 | Orders | card",
      "2 | Revenue | dashboard",
      "",
      "[2 of 2 results]",
    ].join("\n"),
  );
});

test("a truncated list carries the steering message that names the next call", () => {
  const envelope = buildListEnvelope([{ id: 1, name: "Orders" }], {
    total: 40,
    steering: { noun: "tables", narrowWith: ["schema"], pageWith: "offset" },
  });
  expect(payloadText({ kind: "list", noun: "tables", envelope })).toBe(
    ["id | name", "1 | Orders", "", "[40 tables — narrow with `schema`, page with `offset`]"].join(
      "\n",
    ),
  );
});

test("an empty list says so instead of rendering an empty table", () => {
  const envelope = buildListEnvelope([], { total: 0, steering: { noun: "cards" } });
  expect(payloadText({ kind: "list", noun: "cards", envelope })).toBe("No cards found.");
});

test("a dataset header carries the column types, so the rows below need no keys", () => {
  const text = payloadText({
    kind: "dataset",
    columns: [
      { name: "id", base_type: "type/BigInteger" },
      { name: "total", base_type: "type/Float", semantic_type: null },
      { name: "email", base_type: "type/Text", semantic_type: "type/Email" },
    ],
    rows: [
      [1, 42.5, "a@b.com"],
      [2, null, "c@d.com"],
    ],
    returned: 2,
    offset: 0,
  });
  expect(text).toBe(
    [
      "id (type/BigInteger) | total (type/Float) | email (type/Text, type/Email)",
      "1 | 42.5 | a@b.com",
      "2 | NULL | c@d.com",
      "",
      "[rows 1-2]",
    ].join("\n"),
  );
});

test("a paged dataset reports its window and how to fetch the next one", () => {
  const text = payloadText({
    kind: "dataset",
    columns: [{ name: "id" }],
    rows: [[3]],
    returned: 1,
    offset: 2,
    continuation: "More rows available — call again with the same `sql` and offset 3.",
  });
  expect(text).toBe(
    [
      "id",
      "3",
      "",
      "[rows 3-3. More rows available — call again with the same `sql` and offset 3.]",
    ].join("\n"),
  );
});

test("sections group each table's fields under its own heading", () => {
  const text = payloadText({
    kind: "sections",
    noun: "fields",
    sections: [
      {
        title: "ORDERS (table 5, schema public)",
        items: [{ id: 1, name: "ID", base_type: "type/BigInteger" }],
        notice: "1 of 9 fields — continue with get_fields(table_ids: [5], offset: 1)",
      },
      { title: "PEOPLE (table 6, schema public)", items: [{ id: 2, name: "EMAIL" }] },
    ],
    notices: ["table 7: Not found."],
  });
  expect(text).toBe(
    [
      "## ORDERS (table 5, schema public)",
      "id | name | base_type",
      "1 | ID | type/BigInteger",
      "[1 of 9 fields — continue with get_fields(table_ids: [5], offset: 1)]",
      "",
      "## PEOPLE (table 6, schema public)",
      "id | name",
      "2 | EMAIL",
      "",
      "[table 7: Not found.]",
    ].join("\n"),
  );
});

test("a json payload reaches the model as bare json, with the label kept out of it", () => {
  expect(payloadText({ kind: "json", label: "created collection 5", value: { id: 5 } })).toBe(
    '{"id":5}',
  );
});

test("the error results pi synthesizes are not mistaken for a payload", () => {
  expect(isToolPayload({})).toBe(false);
  expect(isToolPayload({ kind: "list" })).toBe(true);
});
