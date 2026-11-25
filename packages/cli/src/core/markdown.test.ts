import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { codeBlocks, readMarkdownLines, splitFrontmatter } from "./markdown";

const FENCE = "```";

describe("splitFrontmatter", () => {
  it("gives the line the body starts on", () => {
    expect(splitFrontmatter("\n---\ntitle: A\nsummary: B\n---\n\nBody.\n", "guides/a.md")).toEqual({
      yaml: "\ntitle: A\nsummary: B",
      body: "\nBody.\n",
      bodyLine: 6,
    });
  });

  it("gives an empty body when the file ends at the closing delimiter", () => {
    expect(splitFrontmatter("---\ntitle: A\n---", "guides/a.md")).toEqual({
      yaml: "\ntitle: A",
      body: "",
      bodyLine: 3,
    });
  });

  it("refuses a file whose frontmatter never closes", () => {
    expect(() => splitFrontmatter("---\ntitle: A\n", "guides/a.md")).toThrow(
      new ConfigError("guides/a.md: unterminated frontmatter"),
    );
  });
});

describe("codeBlocks", () => {
  it("gives each block's language, text and first line, counted from the line given", () => {
    const text = [
      "Intro.",
      `${FENCE}sh title="x"`,
      "mb card list",
      "",
      "mb card get 1",
      FENCE,
      FENCE,
      "plain",
      FENCE,
    ].join("\n");

    expect(codeBlocks(readMarkdownLines(text, 10))).toEqual([
      { language: "sh", firstLine: 12, text: "mb card list\n\nmb card get 1" },
      { language: null, firstLine: 17, text: "plain" },
    ]);
  });

  it("keeps a shorter or different fence inside a block as its text", () => {
    const text = ["~~~~md", FENCE, "~~~", "~~~~", "After."].join("\n");

    expect(codeBlocks(readMarkdownLines(text))).toEqual([
      { language: "md", firstLine: 2, text: `${FENCE}\n~~~` },
    ]);
  });

  it("reads a block that is never closed to the end of the text", () => {
    expect(codeBlocks(readMarkdownLines(`${FENCE}json\n{}`))).toEqual([
      { language: "json", firstLine: 2, text: "{}" },
    ]);
  });
});
