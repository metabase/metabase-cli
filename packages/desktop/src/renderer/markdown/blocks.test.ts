import { describe, expect, it } from "vitest";

import { splitBlocks } from "./blocks";

const STREAMED = [
  "Here is what I found.",
  "",
  "```sql",
  "select count(*)",
  "from orders",
  "",
  "where created_at > now()",
  "```",
  "",
  "The table has three problems:",
  "",
  "- orders.status is a string",
  "",
  "- orders.total has no currency",
  "",
  "Indented output follows.",
  "",
  "    $ mb transform run",
  "",
  "    ok",
  "",
  "> A quote",
  ">",
  "> carried over a gap.",
  "",
  "That is all.",
].join("\n");

describe("splitting a message into finished blocks and the one still being written", () => {
  it("cuts a paragraph off at the blank line after it", () => {
    expect(splitBlocks("First.\n\nSecond.", "settled")).toEqual({
      stable: ["First."],
      tail: "Second.",
    });
  });

  it("keeps a message with no blank line whole, as the tail", () => {
    expect(splitBlocks("Still writing", "settled")).toEqual({ stable: [], tail: "Still writing" });
  });

  it("holds an unclosed fence and everything in it in the tail", () => {
    expect(splitBlocks("Intro.\n\n```sql\nselect 1\n\nselect 2", "settled")).toEqual({
      stable: ["Intro."],
      tail: "```sql\nselect 1\n\nselect 2",
    });
  });

  it("cuts after a fence the agent has closed", () => {
    expect(splitBlocks("```sql\nselect 1\n```\n\nDone.", "settled")).toEqual({
      stable: ["```sql\nselect 1\n```"],
      tail: "Done.",
    });
  });

  it("does not take a longer run inside a fence for its closer", () => {
    expect(splitBlocks("````md\n```\nnested\n```\n````\n\nAfter.", "settled")).toEqual({
      stable: ["````md\n```\nnested\n```\n````"],
      tail: "After.",
    });
  });

  it("keeps a list whose items breathe as one list", () => {
    expect(splitBlocks("1. first\n\n2. second\n\nAfter.", "settled")).toEqual({
      stable: ["1. first\n\n2. second"],
      tail: "After.",
    });
  });

  it("keeps an indented code block with a blank line in it whole", () => {
    expect(splitBlocks("Output:\n\n    one\n\n    two\n\nAfter.", "settled")).toEqual({
      stable: ["Output:\n\n    one\n\n    two"],
      tail: "After.",
    });
  });

  it("keeps a quote carried over a gap whole", () => {
    expect(splitBlocks("> one\n\n> two\n\nAfter.", "settled")).toEqual({
      stable: ["> one\n\n> two"],
      tail: "After.",
    });
  });

  it("leaves the tail empty when the message ends on a blank line", () => {
    expect(splitBlocks("Done.\n\n", "settled")).toEqual({ stable: [], tail: "Done.\n\n" });
  });
});

describe("growing one character at a time", () => {
  it("never rewrites a block it has already finished", () => {
    let settled: readonly string[] = [];
    for (let length = 1; length <= STREAMED.length; length += 1) {
      const blocks = splitBlocks(STREAMED.slice(0, length), "streaming");
      expect(blocks.stable.slice(0, settled.length)).toEqual([...settled]);
      settled = blocks.stable;
    }
    expect(settled.length).toBeGreaterThan(1);
  });

  it("reaches the same blocks as parsing the finished message in one go", () => {
    const grown = splitBlocks(STREAMED, "streaming");
    const whole = splitBlocks(STREAMED, "settled");

    expect(whole.stable.slice(0, grown.stable.length)).toEqual([...grown.stable]);
    expect(whole.tail).toBe("That is all.");
  });
});
