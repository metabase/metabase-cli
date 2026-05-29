import { describe, expect, it } from "vitest";

import { TipTapNode } from "../../domain/document";

import { normalizeDocumentBody } from "./normalize";

describe("normalizeDocumentBody", () => {
  it("mints ids on id-bearing nodes, skips wrappers/leaves, and appends a trailing paragraph", () => {
    const doc: TipTapNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "resizeNode",
          attrs: { height: 400 },
          content: [{ type: "cardEmbed", attrs: { id: 9, name: null } }],
        },
      ],
    };

    expect(normalizeDocumentBody(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, _id: expect.any(String) },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "resizeNode",
          attrs: { height: 400 },
          content: [{ type: "cardEmbed", attrs: { id: 9, name: null, _id: expect.any(String) } }],
        },
        { type: "paragraph", attrs: { _id: expect.any(String) } },
      ],
    });
  });

  it("preserves existing ids and reassigns duplicates, keeping the first occurrence", () => {
    const doc: TipTapNode = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { _id: "keep" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { _id: "keep" }, content: [{ type: "text", text: "b" }] },
      ],
    };

    const result = normalizeDocumentBody(doc);
    const reassignedId = result.content?.[1]?.attrs?.["_id"];
    
    expect(result).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { _id: "keep" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { _id: reassignedId }, content: [{ type: "text", text: "b" }] },
      ],
    });
  });

  it("does not append a trailing paragraph when the last top-level child is already a paragraph", () => {
    const doc: TipTapNode = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "x" }, content: [{ type: "text", text: "z" }] }],
    };

    expect(normalizeDocumentBody(doc)).toEqual({
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "x" }, content: [{ type: "text", text: "z" }] }],
    });
  });
});
