import { getCapabilities, hyperlink, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, expect, test } from "vitest";
import { GLYPH } from "./glyphs";
import { createLinker } from "./link";
import { toolCallView } from "./tool-call";

const terminal = getCapabilities();

afterEach(() => {
  setCapabilities(terminal);
});

test("a browse action becomes the verb in the header rather than an argument beside it", () => {
  expect(
    toolCallView("browse_data", "Browse data", {
      action: "list_tables",
      database_id: 1,
      schema: "public",
    }),
  ).toEqual({
    line: { icon: GLYPH.browse, title: "Browse tables", detail: "public", meta: ["database 1"] },
  });
});

test("browsing fields counts the tables rather than listing their ids", () => {
  expect(
    toolCallView("browse_data", "Browse data", { action: "get_fields", table_ids: [3, 4, 5] }),
  ).toEqual({
    line: { icon: GLYPH.browse, title: "Browse fields", detail: "of 3 tables", meta: [] },
  });
});

test("a search quotes its keywords and demotes its filters to meta", () => {
  expect(
    toolCallView("search", "Search", {
      query: "revenue",
      type: ["card", "dashboard"],
      collection_id: 7,
      limit: 20,
    }),
  ).toEqual({
    line: {
      icon: GLYPH.search,
      title: "Search",
      detail: '"revenue"',
      meta: ["card, dashboard", "collection 7", "limit 20"],
    },
  });
});

test("execute_sql carries the SQL as a body the terminal can highlight", () => {
  expect(
    toolCallView("execute_sql", "Execute SQL", {
      database_id: 1,
      sql: "SELECT count(*) FROM orders",
    }),
  ).toEqual({
    line: { icon: GLYPH.execute, title: "Execute SQL", detail: "", meta: ["database 1"] },
    body: { language: "sql", text: "SELECT count(*) FROM orders" },
  });
});

test("a create names the thing it creates, and its card_type is the noun", () => {
  expect(
    toolCallView("question_write", "Write question", {
      method: "create",
      card_type: "metric",
      name: "Revenue by month",
      collection_id: 7,
      display: "line",
    }),
  ).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Create metric",
      detail: '"Revenue by month"',
      meta: ["collection 7", "line"],
    },
  });
});

test("archiving reads as archiving, not as an update carrying a flag", () => {
  expect(
    toolCallView("question_write", "Write question", { method: "update", id: 42, archived: true }),
  ).toEqual({
    line: { icon: GLYPH.remove, title: "Archive question", detail: "42", meta: [] },
  });
});

test("a native question shows the SQL it is about to save", () => {
  expect(
    toolCallView("question_write", "Write question", {
      method: "create",
      name: "Active users",
      native: { database_id: 1, sql: "SELECT * FROM users" },
    }),
  ).toEqual({
    line: { icon: GLYPH.write, title: "Create question", detail: '"Active users"', meta: [] },
    body: { language: "sql", text: "SELECT * FROM users" },
  });
});

test("get_content previews the first items and counts the rest", () => {
  const items = [
    { type: "question", id: 1 },
    { type: "dashboard", id: 2 },
    { type: "collection", id: 3 },
    { type: "snippet", id: 4 },
  ];
  expect(toolCallView("get_content", "Get content", { items })).toEqual({
    line: {
      icon: GLYPH.fetch,
      title: "Get content",
      detail: "question 1, dashboard 2, collection 3 +1",
      meta: undefined,
    },
  });
});

test("a duplicate names both ends of the copy", () => {
  expect(
    toolCallView("duplicate_content", "Duplicate content", {
      type: "dashboard",
      id: 3,
      collection_id: 7,
      is_deep_copy: true,
      new_name: "Q3 Review — draft",
    }),
  ).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Duplicate",
      detail: `dashboard 3 ${GLYPH.fetch} "Q3 Review — draft"`,
      meta: ["collection 7", "deep copy"],
    },
  });
});

test("a tool this file does not know still gets a header, and claims nothing about its arguments", () => {
  expect(toolCallView("some_new_tool", "Some new tool", { whatever: true })).toEqual({
    line: { icon: GLYPH.execute, title: "Some new tool" },
  });
});

test("arguments still streaming fall back to the label instead of rendering a half-parsed call", () => {
  expect(toolCallView("search", "Search", { query: 12 })).toEqual({
    line: { icon: GLYPH.execute, title: "Search" },
  });
});

test("the ids a header prints are addresses on the instance, not decoration", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const link = createLinker("https://mb.example.com");

  expect(
    toolCallView(
      "question_write",
      "Write question",
      { method: "create", name: "Recent Orders", collection_id: 18, display: "table" },
      link,
    ),
  ).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Create question",
      detail: '"Recent Orders"',
      meta: [hyperlink("collection 18", "https://mb.example.com/collection/18"), "table"],
    },
  });

  expect(
    toolCallView("run_saved_question", "Run question", { id: 42, row_limit: 5 }, link),
  ).toEqual({
    line: {
      icon: GLYPH.execute,
      title: "Run question",
      detail: hyperlink("42", "https://mb.example.com/question/42"),
      meta: ["limit 5"],
    },
  });
});

test("an update links the entity it is about to write", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const link = createLinker("https://mb.example.com");

  expect(
    toolCallView("dashboard_write", "Write dashboard", { method: "update", id: 9 }, link),
  ).toEqual({
    line: {
      icon: GLYPH.write,
      title: "Update dashboard",
      detail: hyperlink("9", "https://mb.example.com/dashboard/9"),
      meta: [],
    },
  });
});
