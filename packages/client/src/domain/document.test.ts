import { describe, expect, it } from "vitest";

import { TipTapNodeInput } from "./document";

describe("TipTapNodeInput", () => {
  it("accepts a document where id-bearing nodes carry an _id and other node types don't", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, _id: "h1" }, content: [{ type: "text", text: "T" }] },
        {
          type: "resizeNode",
          attrs: { height: 400 },
          content: [{ type: "cardEmbed", attrs: { id: 9, name: null, _id: "c1" } }],
        },
        { type: "paragraph", attrs: { _id: "p1" } },
      ],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(true);
  });

  it("rejects an id-bearing node missing its _id", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(false);
  });

  it("rejects an id-bearing node whose _id is an empty string", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "" }, content: [{ type: "text", text: "x" }] }],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(false);
  });
});
