import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { capListEnvelope } from "./cap";
import type { ListEnvelope } from "./types";

interface Item {
  id: number;
  name: string;
}

function envelope(items: Item[]): ListEnvelope<Item> {
  return { data: items, returned: items.length, total: items.length };
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
    const result = capListEnvelope(input, 200);
    expect(
      result.data.every((item) => typeof item.name === "string" && item.name.length === 100),
    ).toBe(true);
    expect(result.returned).toBe(result.data.length);
    expect(result.truncated).toEqual({ reason: "max_bytes", bytes: byteLength(input) });
    expect(byteLength(result)).toBeLessThanOrEqual(200);
  });

  it("can truncate to zero items when even one would not fit", () => {
    const input = envelope([{ id: 1, name: "x".repeat(500) }]);
    const result = capListEnvelope(input, 50);
    expect(result.data).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.truncated).toEqual({ reason: "max_bytes", bytes: byteLength(input) });
  });

  it("preserves total/limit fields after truncation", () => {
    const input: ListEnvelope<Item> = {
      data: [
        { id: 1, name: "a".repeat(50) },
        { id: 2, name: "b".repeat(50) },
        { id: 3, name: "c".repeat(50) },
      ],
      returned: 3,
      total: 17,
      limit: 50,
    };
    const result = capListEnvelope(input, 100);
    expect(result.total).toBe(17);
    expect(result.limit).toBe(50);
  });

  it("property: a generously-sized cap fits and returns input unchanged when input fits", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.integer(), name: fc.string() }), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 200, max: 20_000 }),
        (items, maxBytes) => {
          const input = envelope(items);
          const result = capListEnvelope(input, maxBytes);
          if (byteLength(input) <= maxBytes) {
            expect(result).toEqual(input);
            return;
          }
          expect(result.returned).toBe(result.data.length);
          expect(result.truncated?.bytes).toBe(byteLength(input));
          if (result.data.length > 0) {
            expect(byteLength(result)).toBeLessThanOrEqual(maxBytes);
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
          const result = capListEnvelope(envelope(items), maxBytes);
          for (let index = 0; index < result.data.length; index += 1) {
            expect(result.data[index]).toEqual(items[index]);
          }
        },
      ),
    );
  });
});
