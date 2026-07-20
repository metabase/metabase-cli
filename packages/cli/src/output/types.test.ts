import { describe, expect, it } from "vitest";
import { z } from "zod";

import { listEnvelopeSchema, wrapList, type ListEnvelope } from "./types";

const Person = z.object({ id: z.number().int(), name: z.string() }).strict();

describe("listEnvelopeSchema", () => {
  it("accepts a minimal envelope with only data and returned", () => {
    const schema = listEnvelopeSchema(Person);
    const envelope = { data: [{ id: 1, name: "x" }], returned: 1 };
    expect(schema.parse(envelope)).toEqual(envelope);
  });

  it("accepts an envelope with all optional fields populated", () => {
    const schema = listEnvelopeSchema(Person);
    const envelope: ListEnvelope<{ id: number; name: string }> = {
      data: [{ id: 1, name: "x" }],
      returned: 1,
      total: 50,
      limit: 25,
      truncated: { reason: "max_bytes", bytes: 4096 },
    };
    expect(schema.parse(envelope)).toEqual(envelope);
  });

  it("rejects an envelope whose items fail the item schema", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({
      data: [{ id: "not-a-number", name: "x" }],
      returned: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative returned count", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({ data: [], returned: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer total", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({ data: [], returned: 0, total: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects truncated.reason that is not the literal 'max_bytes'", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({
      data: [],
      returned: 0,
      truncated: { reason: "wrong-reason", bytes: 100 },
    });
    expect(result.success).toBe(false);
  });
});

describe("wrapList", () => {
  it("returns an envelope whose returned and total reflect the array length", () => {
    expect(
      wrapList([
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ]),
    ).toEqual({
      data: [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ],
      returned: 2,
      total: 2,
    });
  });

  it("returns a zero-length envelope for an empty input", () => {
    expect(wrapList([])).toEqual({ data: [], returned: 0, total: 0 });
  });

  it("composes with listEnvelopeSchema — wrapList output round-trips through the schema", () => {
    const schema = listEnvelopeSchema(Person);
    const envelope = wrapList([{ id: 1, name: "x" }]);
    expect(schema.parse(envelope)).toEqual(envelope);
  });
});
