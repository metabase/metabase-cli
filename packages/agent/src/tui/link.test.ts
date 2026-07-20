import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, expect, test } from "vitest";
import { createLinker, PLAIN_LINKER } from "./link";

const BASE = "https://metabase.example.com/analytics";

const before = getCapabilities();

afterEach(() => {
  setCapabilities(before);
});

function linking(): ReturnType<typeof createLinker> {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  return createLinker(BASE);
}

test("an entity's href hangs off the instance's base URL, subpath and all", () => {
  const link = linking();
  expect(link.href({ kind: "collection", id: 18 })).toBe(
    "https://metabase.example.com/analytics/collection/18",
  );
  expect(link.href({ kind: "question", id: 42 })).toBe(
    "https://metabase.example.com/analytics/question/42",
  );
  expect(link.href({ kind: "database", id: 2 })).toBe(
    "https://metabase.example.com/analytics/browse/databases/2",
  );
  expect(link.href({ kind: "transform_job", id: 7 })).toBe(
    "https://metabase.example.com/analytics/data-studio/transforms/jobs/7",
  );
});

test("the root collection is named, not numbered, and its id passes through", () => {
  expect(linking().href({ kind: "collection", id: "root" })).toBe(
    "https://metabase.example.com/analytics/collection/root",
  );
});

// `/table/:id` needs the table-metadata permission; the ad-hoc question over it needs only the data.
test("a table known to sit in a database is linked as a question over it", () => {
  const link = linking();
  expect(link.href({ kind: "table", id: 180, databaseId: 2 })).toBe(
    "https://metabase.example.com/analytics/question#?db=2&table=180",
  );
  expect(link.href({ kind: "table", id: 180 })).toBe(
    "https://metabase.example.com/analytics/table/180",
  );
});

test("a linked label carries the OSC 8 sequence around the text and nothing else", () => {
  const link = linking();
  const url = "https://metabase.example.com/analytics/collection/18";
  expect(link.text("collection 18", { kind: "collection", id: 18 })).toBe(
    `\u001b]8;;${url}\u001b\\collection 18\u001b]8;;\u001b\\`,
  );
  expect(link.text("collection 18", null)).toBe("collection 18");
});

test("a terminal that would print the escape codes instead of obeying them gets plain text", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false });
  const link = createLinker(BASE);
  expect(link.href({ kind: "collection", id: 18 })).toBeNull();
  expect(link.text("collection 18", { kind: "collection", id: 18 })).toBe("collection 18");
});

test("a session with no instance to point at links nothing", () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: true });
  const link = createLinker(null);
  expect(link).toBe(PLAIN_LINKER);
  expect(link.text("collection 18", { kind: "collection", id: 18 })).toBe("collection 18");
});
