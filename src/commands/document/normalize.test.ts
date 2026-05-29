import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TipTapNode } from "../../domain/document";

import { normalizeDocumentBody } from "./normalize";

function sequentialIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function flatten(node: TipTapNode): TipTapNode[] {
  const children = node.content ?? [];
  return [node, ...children.flatMap(flatten)];
}

const nodeArb: fc.Arbitrary<TipTapNode> = fc.letrec<{ node: TipTapNode }>((tie) => ({
  node: fc
    .tuple(
      fc.constantFrom(
        "paragraph",
        "heading",
        "cardEmbed",
        "bulletList",
        "listItem",
        "resizeNode",
        "text",
      ),
      // Small id domain so existing ids collide and exercise the dedup path.
      fc.option(fc.constantFrom("a", "b", "c"), { nil: undefined }),
      fc.option(fc.array(tie("node"), { maxLength: 2 }), { nil: undefined }),
    )
    .map(([type, id, content]) => {
      const node: TipTapNode = { type };
      if (id !== undefined) {
        node.attrs = { _id: id };
      }
      if (content !== undefined) {
        node.content = content;
      }
      return node;
    }),
})).node;

const docArb: fc.Arbitrary<TipTapNode> = fc
  .array(nodeArb, { maxLength: 4 })
  .map((content) => ({ type: "doc", content }));

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

    expect(normalizeDocumentBody(doc, sequentialIds())).toEqual({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, _id: "id-1" },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "resizeNode",
          attrs: { height: 400 },
          content: [{ type: "cardEmbed", attrs: { id: 9, name: null, _id: "id-2" } }],
        },
        { type: "paragraph", attrs: { _id: "id-3" } },
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

    expect(normalizeDocumentBody(doc, sequentialIds())).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { _id: "keep" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { _id: "id-1" }, content: [{ type: "text", text: "b" }] },
      ],
    });
  });

  it("does not append a trailing paragraph when the last top-level child is already a paragraph", () => {
    const doc: TipTapNode = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "x" }, content: [{ type: "text", text: "z" }] }],
    };

    expect(normalizeDocumentBody(doc, sequentialIds())).toEqual({
      type: "doc",
      content: [{ type: "paragraph", attrs: { _id: "x" }, content: [{ type: "text", text: "z" }] }],
    });
  });

  it("holds its invariants over arbitrary documents", () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const normalized = normalizeDocumentBody(doc, sequentialIds());
        const nodes = flatten(normalized);

        // `paragraph` is a managed (id-bearing) type, so every paragraph must end up with a
        // string `_id`, and the ids the normalizer manages must be unique (dedup contract).
        const paragraphIds = nodes
          .filter((node) => node.type === "paragraph")
          .map((node) => node.attrs?.["_id"]);
        for (const id of paragraphIds) {
          expect(typeof id).toBe("string");
        }
        expect(new Set(paragraphIds).size).toBe(paragraphIds.length);

        const top = normalized.content ?? [];
        expect(top[top.length - 1]?.type).toBe("paragraph");

        const reNormalized = normalizeDocumentBody(normalized, () => {
          throw new Error("normalization should not mint ids on an already-normalized document");
        });
        // Idempotent input is returned as the identical object — no id minted, no node rebuilt.
        expect(reNormalized).toBe(normalized);
      }),
    );
  });
});
