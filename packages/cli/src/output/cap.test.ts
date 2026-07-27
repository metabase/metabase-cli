import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { capListEnvelope } from "./cap";
import type { ListEnvelope } from "./types";

interface Item {
  id: number;
  name: string;
}

function envelope(items: Item[]): ListEnvelope<Item> {
  return {
    data: items,
    returned: items.length,
    offset: 0,
    total: items.length,
    has_more: false,
    next_offset: null,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("capListEnvelope", () => {
  it("returns input unchanged when maxBytes is 0", () => {
    const input = envelope([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(capListEnvelope(input, 0)).toEqual(input);
  });

  it("returns input unchanged when fully under cap", () => {
    const input = envelope([{ id: 1, name: "a" }]);
    expect(capListEnvelope(input, 10_000)).toEqual(input);
  });

  it("drops tail items when over cap, never partial", () => {
    const input = envelope([
      { id: 1, name: "a".repeat(100) },
      { id: 2, name: "b".repeat(100) },
      { id: 3, name: "c".repeat(100) },
    ]);
    const result = capListEnvelope(input, 400);
    expect(
      result.data.every((item) => typeof item.name === "string" && item.name.length === 100),
    ).toBe(true);
    expect(result.returned).toBe(result.data.length);
    expect(result.truncated).toEqual({ reason: "max_bytes", bytes: byteLength(input) });
    expect(byteLength(result)).toBeLessThanOrEqual(400);
  });

  // The rows are unreachable by offset — asking again at the same one returns the same answer —
  // so the window reports that they exist and offers nothing to follow.
  it("keeps no row when none fits, and offers no offset to resume from", () => {
    const input: ListEnvelope<Item> = {
      ...envelope([{ id: 1, name: "x".repeat(500) }]),
      offset: 6,
    };

    expect(capListEnvelope(input, 50)).toEqual({
      data: [],
      returned: 0,
      offset: 6,
      total: 1,
      has_more: true,
      next_offset: null,
      truncated: { reason: "max_bytes", bytes: byteLength(input) },
    });
  });

  it("leaves an empty window alone when the cap cannot hold even the bare envelope", () => {
    const input = envelope([]);

    expect(capListEnvelope(input, 10)).toEqual(input);
  });

  it("makes the cut resumable: next_offset points at the first dropped item", () => {
    const input: ListEnvelope<Item> = {
      data: [
        { id: 1, name: "a".repeat(100) },
        { id: 2, name: "b".repeat(100) },
        { id: 3, name: "c".repeat(100) },
      ],
      returned: 3,
      offset: 40,
      total: 500,
      has_more: true,
      next_offset: 43,
    };

    const result = capListEnvelope(input, 250);

    expect(result).toEqual({
      data: [{ id: 1, name: "a".repeat(100) }],
      returned: 1,
      offset: 40,
      total: 500,
      has_more: true,
      next_offset: 41,
      truncated: { reason: "max_bytes", bytes: byteLength(input) },
    });
  });

  it("reports a continuation even when the source thought it was done", () => {
    const input: ListEnvelope<Item> = {
      data: [
        { id: 1, name: "a".repeat(100) },
        { id: 2, name: "b".repeat(100) },
      ],
      returned: 2,
      offset: 7,
      total: 9,
      has_more: false,
      next_offset: null,
    };

    const result = capListEnvelope(input, 250);

    expect(result).toEqual({
      data: [{ id: 1, name: "a".repeat(100) }],
      returned: 1,
      offset: 7,
      total: 9,
      has_more: true,
      next_offset: 8,
      truncated: { reason: "max_bytes", bytes: byteLength(input) },
    });
  });

  it("spends the envelope's own metadata out of the same budget as the rows", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: index, name: `row-${index}` }));

    const result = capListEnvelope(envelope(items), 300);

    expect(result.returned).toBe(7);
    expect(byteLength(result)).toBe(292);
  });

  it("preserves total/limit fields after truncation", () => {
    const input: ListEnvelope<Item> = {
      data: [
        { id: 1, name: "a".repeat(50) },
        { id: 2, name: "b".repeat(50) },
        { id: 3, name: "c".repeat(50) },
      ],
      returned: 3,
      offset: 0,
      total: 17,
      limit: 50,
      has_more: true,
      next_offset: 3,
    };
    const result = capListEnvelope(input, 250);
    expect(result.total).toBe(17);
    expect(result.limit).toBe(50);
  });

  it("property: a cut that kept rows fits the cap and advances past them", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.integer(), name: fc.string() }), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 30, max: 20_000 }),
        (items, maxBytes) => {
          const input = envelope(items);
          const outcome = capListEnvelope(input, maxBytes);
          if (byteLength(input) <= maxBytes) {
            expect(outcome).toEqual(input);
            return;
          }
          expect(outcome.returned).toBe(outcome.data.length);
          expect(outcome.truncated?.bytes).toBe(byteLength(input));
          if (outcome.returned === 0) {
            return;
          }
          expect(byteLength(outcome)).toBeLessThanOrEqual(maxBytes);
          expect(outcome.next_offset).toBe(outcome.offset + outcome.returned);
        },
      ),
    );
  });

  // The window a caller is sent back to must be a window they have not already read: an offset
  // that repeats or skips is worse than no offset at all, which is what a zero-row cut carries.
  it("property: a next_offset always advances, and a zero-row cut carries none", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.integer(), name: fc.string() }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 30, max: 1_000 }),
        fc.integer({ min: 0, max: 500 }),
        (items, maxBytes, offset) => {
          const input: ListEnvelope<Item> = { ...envelope(items), offset };
          const outcome = capListEnvelope(input, maxBytes);
          if (outcome.returned === 0 && outcome.truncated !== undefined) {
            expect(outcome.has_more).toBe(true);
            expect(outcome.next_offset).toBeNull();
            return;
          }
          if (typeof outcome.next_offset === "number") {
            expect(outcome.next_offset).toBeGreaterThan(outcome.offset);
          }
        },
      ),
    );
  });

  it("property: truncated data is always a prefix of input data", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.integer(), name: fc.string() }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.integer({ min: 30, max: 1_000 }),
        (items, maxBytes) => {
          const outcome = capListEnvelope(envelope(items), maxBytes);
          for (let index = 0; index < outcome.data.length; index += 1) {
            expect(outcome.data[index]).toEqual(items[index]);
          }
        },
      ),
    );
  });
});
