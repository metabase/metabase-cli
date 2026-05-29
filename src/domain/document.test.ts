import { describe, expect, it } from "vitest";

import { TipTapNodeInput } from "./document";

describe("TipTapNodeInput", () => {
  it("accepts a document with an _id on every node", () => {
    const doc = {
      type: "doc",
      attrs: { _id: "d1" },
      content: [
        {
          type: "paragraph",
          attrs: { _id: "p1" },
          content: [{ type: "text", text: "hi", attrs: { _id: "t1" } }],
        },
      ],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(true);
  });

  it("rejects a document with a node missing its _id", () => {
    const doc = {
      type: "doc",
      attrs: { _id: "d1" },
      content: [
        { type: "paragraph", attrs: { _id: "p1" }, content: [{ type: "text", text: "hi" }] },
      ],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(false);
  });

  it("rejects when the root node has no _id", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "p1" } }],
    };

    expect(TipTapNodeInput.safeParse(doc).success).toBe(false);
  });
});
