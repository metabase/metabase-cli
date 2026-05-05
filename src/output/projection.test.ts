import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError } from "../core/errors";
import type { ResourceView } from "../domain/view";
import { applyProjection } from "./projection";

const Card = z.object({
  id: z.number().int(),
  name: z.string(),
  archived: z.boolean(),
  database: z.object({
    id: z.number().int(),
    engine: z.string(),
  }),
});
type Card = z.infer<typeof Card>;

const cardCompact = Card.pick({ id: true, name: true });

const cardView: ResourceView<Card> = {
  compactPick: cardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
  ],
};

const sample: Card = {
  id: 1,
  name: "Sales",
  archived: false,
  database: { id: 9, engine: "postgres" },
};

describe("applyProjection", () => {
  it("compact (full=false, no fields) projects via view.compactPick", () => {
    expect(applyProjection(sample, cardView, false, undefined)).toEqual({
      id: 1,
      name: "Sales",
    });
  });

  it("full=true returns the value as-is", () => {
    expect(applyProjection(sample, cardView, true, undefined)).toEqual(sample);
  });

  it("fields projects flat dot paths", () => {
    expect(applyProjection(sample, cardView, false, ["id", "name"])).toEqual({
      id: 1,
      name: "Sales",
    });
  });

  it("fields projects nested dot paths", () => {
    expect(applyProjection(sample, cardView, false, ["database.engine"])).toEqual({
      database: { engine: "postgres" },
    });
  });

  it("fields combines flat and nested paths", () => {
    expect(
      applyProjection(sample, cardView, false, ["id", "database.id", "database.engine"]),
    ).toEqual({
      id: 1,
      database: { id: 9, engine: "postgres" },
    });
  });

  it("fields throws ConfigError on unknown top-level key", () => {
    expect(() => applyProjection(sample, cardView, false, ["nope"])).toThrow(
      new ConfigError(`unknown field path: "nope"`),
    );
  });

  it("fields throws ConfigError on unknown nested key", () => {
    expect(() => applyProjection(sample, cardView, false, ["database.missing"])).toThrow(
      new ConfigError(`unknown field path: "database.missing"`),
    );
  });

  it("fields throws ConfigError when descending into a non-object", () => {
    expect(() => applyProjection(sample, cardView, false, ["id.nested"])).toThrow(
      new ConfigError(`unknown field path: "id.nested"`),
    );
  });

  it("fields throws ConfigError on empty fields list", () => {
    expect(() => applyProjection(sample, cardView, false, [])).toThrow(
      new ConfigError("--fields requires at least one path"),
    );
  });

  it("fields rejects empty path segments", () => {
    expect(() => applyProjection(sample, cardView, false, ["database..id"])).toThrow(
      new ConfigError(`invalid field path: "database..id"`),
    );
  });

  it("property: compact output is always a strict subset of input keys", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.integer(),
          name: fc.string(),
          archived: fc.boolean(),
          database: fc.record({ id: fc.integer(), engine: fc.string() }),
        }),
        (input) => {
          const result = applyProjection(input, cardView, false, undefined);
          expect(result).toEqual({ id: input.id, name: input.name });
        },
      ),
    );
  });

  it("property: any subset of valid paths round-trips through projection", () => {
    const allPaths = ["id", "name", "archived", "database.id", "database.engine"];
    fc.assert(
      fc.property(
        fc.record({
          id: fc.integer(),
          name: fc.string(),
          archived: fc.boolean(),
          database: fc.record({ id: fc.integer(), engine: fc.string() }),
        }),
        fc.subarray(allPaths, { minLength: 1 }),
        (input, paths) => {
          const projected = applyProjection(input, cardView, false, paths);
          for (const path of paths) {
            const parts = path.split(".");
            let cursor: unknown = projected;
            let original: unknown = input;
            for (const part of parts) {
              expect(typeof cursor === "object" && cursor !== null).toBe(true);
              expect(typeof original === "object" && original !== null).toBe(true);
              cursor = isObject(cursor) ? Reflect.get(cursor, part) : undefined;
              original = isObject(original) ? Reflect.get(original, part) : undefined;
            }
            expect(cursor).toEqual(original);
          }
        },
      ),
    );
  });
});

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
