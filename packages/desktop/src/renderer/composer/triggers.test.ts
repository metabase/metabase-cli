import { describe, expect, it } from "vitest";

import { appendMention, applyTrigger, matchCommands, matchPaths, triggerAt } from "./triggers";

const PATHS = [
  "transforms/orders.sql",
  "transforms/customers.sql",
  "collections/orders/dashboard.yaml",
  "README.md",
];

describe("reading what the caret is sitting in", () => {
  it("finds a mention the moment its mark is typed", () => {
    expect(triggerAt("look at @", 9)).toEqual({ kind: "mention", query: "", start: 8, end: 9 });
  });

  it("carries the part of the path already typed", () => {
    expect(triggerAt("look at @transforms/or", 22)).toEqual({
      kind: "mention",
      query: "transforms/or",
      start: 8,
      end: 22,
    });
  });

  it("reads a mention on any line", () => {
    expect(triggerAt("first\n@ord", 10)).toEqual({
      kind: "mention",
      query: "ord",
      start: 6,
      end: 10,
    });
  });

  it("reads a command only where it opens the line", () => {
    expect(triggerAt("/com", 4)).toEqual({ kind: "command", query: "com", start: 0, end: 4 });
    expect(triggerAt("run /com", 8)).toBe(null);
  });

  it("gives up once the mention is behind a space", () => {
    expect(triggerAt("look at @orders.sql now", 23)).toBe(null);
  });

  it("finds nothing in ordinary prose", () => {
    expect(triggerAt("clean the orders table", 22)).toBe(null);
  });
});

describe("writing the pick back into the draft", () => {
  it("replaces the half-typed mention and leaves the caret after a space", () => {
    const trigger = triggerAt("look at @tra", 12);

    expect(
      trigger === null ? null : applyTrigger("look at @tra", trigger, "transforms/orders.sql"),
    ).toEqual({
      text: "look at @transforms/orders.sql ",
      cursor: 31,
    });
  });

  it("keeps what the user wrote after the caret", () => {
    const text = "look at @tra later";
    const trigger = triggerAt(text, 12);

    expect(trigger === null ? null : applyTrigger(text, trigger, "transforms/orders.sql")).toEqual({
      text: "look at @transforms/orders.sql  later",
      cursor: 31,
    });
  });
});

describe("matching what the user typed against the repository", () => {
  it("puts a hit on the file's own name before one on a directory", () => {
    expect(matchPaths(PATHS, "orders", 10)).toEqual([
      "transforms/orders.sql",
      "collections/orders/dashboard.yaml",
    ]);
  });

  it("offers everything for an empty query, up to the cap", () => {
    expect(matchPaths(PATHS, "", 2)).toEqual(["transforms/orders.sql", "transforms/customers.sql"]);
  });

  it("ignores the case the user typed", () => {
    expect(matchPaths(PATHS, "README", 10)).toEqual(["README.md"]);
  });

  it("matches a command on the start of its name", () => {
    expect(matchCommands(["compact", "clear", "model"], "c", 10)).toEqual(["compact", "clear"]);
  });
});

describe("appendMention", () => {
  it("starts an empty draft with the mention", () => {
    expect(appendMention("", "scripts/check.ts")).toBe("@scripts/check.ts ");
  });

  it("sets the mention off from the text before it with one space", () => {
    expect(appendMention("Explain this:", "scripts/check.ts")).toBe(
      "Explain this: @scripts/check.ts ",
    );
  });

  it("adds no second space after one already typed", () => {
    expect(appendMention("Explain this:\n", "scripts/check.ts")).toBe(
      "Explain this:\n@scripts/check.ts ",
    );
  });
});
