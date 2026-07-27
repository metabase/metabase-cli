import { describe, expect, it } from "vitest";
import { z } from "zod";

import { listEnvelopeSchema, type ListEnvelope } from "./types";

const Person = z.object({ id: z.number().int(), name: z.string() }).strict();

const JsonSchemaProperties = z
  .object({
    properties: z.record(z.string(), z.object({ description: z.string().optional() }).loose()),
  })
  .loose();

describe("listEnvelopeSchema", () => {
  it("accepts a minimal envelope with only the required position fields", () => {
    const schema = listEnvelopeSchema(Person);
    const envelope = { data: [{ id: 1, name: "x" }], returned: 1, offset: 0, has_more: false };
    expect(schema.parse(envelope)).toEqual(envelope);
  });

  it("accepts an envelope with all optional fields populated", () => {
    const schema = listEnvelopeSchema(Person);
    const envelope: ListEnvelope<{ id: number; name: string }> = {
      data: [{ id: 1, name: "x" }],
      returned: 1,
      offset: 25,
      limit: 25,
      total: 50,
      has_more: true,
      next_offset: 26,
      truncated: { reason: "max_bytes", bytes: 4096 },
    };
    expect(schema.parse(envelope)).toEqual(envelope);
  });

  it("describes every envelope field, and the descriptions survive JSON Schema conversion", () => {
    const { properties } = JsonSchemaProperties.parse(z.toJSONSchema(listEnvelopeSchema(Person)));
    const descriptions = Object.fromEntries(
      Object.entries(properties).map(([field, property]) => [field, property.description]),
    );
    expect(descriptions).toEqual({
      data: "The items in this window.",
      returned: "Number of items in `data`; a short window is not proof the walk is over.",
      offset: "Index of the first item in `data` within the full result set.",
      limit: "Echoes `--limit` when you passed one, and is absent otherwise.",
      total:
        "The server's count on endpoints that report one and `null` on those that don't, so it is a display value rather than a loop bound.",
      has_more:
        "True when more items exist beyond this window; this alone decides whether to keep going, never a comparison of counts. True with a `null` next_offset means the remaining items are reached by widening `--max-bytes` or narrowing the selection, not by paging.",
      next_offset:
        "Pass back as `--offset` to fetch the next window; it is past the offset you sent, and `null` when there is nowhere to resume from — either the walk is over or `--max-bytes` left no room for a single row, which `truncated` tells apart.",
      truncated:
        "Present when the `--max-bytes` cap cut the output, not when the data ran out; its `bytes` is what the untruncated answer would have measured, so narrow rows with `--fields` rather than raising the cap.",
    });
  });

  it("rejects an envelope whose items fail the item schema", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({
      data: [{ id: "not-a-number", name: "x" }],
      returned: 1,
      offset: 0,
      has_more: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative returned count", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({ data: [], returned: -1, offset: 0, has_more: false });
    expect(result.success).toBe(false);
  });

  it("rejects a negative offset", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({ data: [], returned: 0, offset: -1, has_more: false });
    expect(result.success).toBe(false);
  });

  it("rejects a missing has_more", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({ data: [], returned: 0, offset: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer total", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({
      data: [],
      returned: 0,
      offset: 0,
      has_more: false,
      total: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects truncated.reason that is not the literal 'max_bytes'", () => {
    const schema = listEnvelopeSchema(Person);
    const result = schema.safeParse({
      data: [],
      returned: 0,
      offset: 0,
      has_more: false,
      truncated: { reason: "wrong-reason", bytes: 100 },
    });
    expect(result.success).toBe(false);
  });
});
