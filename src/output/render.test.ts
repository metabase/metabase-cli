import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ResourceView } from "../domain/view";
import { parseJson } from "../runtime/json";
import { capListEnvelope } from "./cap";
import { renderItem, renderList } from "./render";
import type { ListEnvelope, RenderOptions } from "./types";

const Card = z.object({
  id: z.number().int(),
  name: z.string(),
  archived: z.boolean(),
});
type Card = z.infer<typeof Card>;

const cardView: ResourceView<Card> = {
  compactPick: Card.pick({ id: true, name: true }),
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
  ],
};

const baseOpts: RenderOptions = {
  format: "json",
  detail: "compact",
  fields: undefined,
  maxBytes: 65536,
};

const TruncatedEnvelope = z.object({
  data: z.array(z.object({ id: z.number(), name: z.string() })),
  returned: z.number(),
  total: z.number(),
  truncated: z.object({ reason: z.literal("max_bytes"), bytes: z.number() }),
});

const CardCompact = Card.pick({ id: true, name: true });
const CardProjected = Card.pick({ id: true, archived: true });
const CardListEnvelope = z.object({
  data: z.array(CardCompact),
  returned: z.number(),
  total: z.number(),
});
const CardProjectedListEnvelope = z.object({
  data: z.array(CardProjected),
  returned: z.number(),
  total: z.number(),
});

interface Streams {
  stdout: string;
  stderr: string;
}

let streams: Streams;

beforeEach(() => {
  streams = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    streams.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    streams.stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderItem", () => {
  it("emits compact JSON by default", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, baseOpts);
    expect(parseJson(streams.stdout, CardCompact)).toEqual({ id: 1, name: "Sales" });
  });

  it("emits the full item when detail=full", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      detail: "full",
    });
    expect(parseJson(streams.stdout, Card)).toEqual({ id: 1, name: "Sales", archived: false });
  });

  it("emits a fields projection when detail=fields", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      detail: "fields",
      fields: ["id", "archived"],
    });
    expect(parseJson(streams.stdout, CardProjected)).toEqual({ id: 1, archived: false });
  });

  it("renders text mode as label/value lines using tableColumns", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      format: "text",
    });
    expect(streams.stdout).toBe("ID    1\nName  Sales\n");
  });

  it("includes every field in text mode when detail=full", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      format: "text",
      detail: "full",
    });
    expect(streams.stdout).toBe("id        1\nname      Sales\narchived  false\n");
  });

  it("emits a stderr notice when JSON output exceeds maxBytes", () => {
    const longName = "x".repeat(200);
    const item: Card = { id: 1, name: longName, archived: false };
    renderItem(item, cardView, {
      ...baseOpts,
      detail: "full",
      maxBytes: 50,
    });
    expect(parseJson(streams.stdout, Card)).toEqual(item);
    const expectedBytes = Buffer.byteLength(JSON.stringify(item, null, 2) + "\n", "utf8");
    expect(streams.stderr).toBe(
      `… item is ${expectedBytes} bytes (exceeds --max-bytes); narrow with --detail compact / --fields, or pass --max-bytes 0\n`,
    );
  });

  it("does not warn when item fits inside maxBytes", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      maxBytes: 65536,
    });
    expect(streams.stderr).toBe("");
  });

  it("disables the oversize notice when maxBytes is 0", () => {
    const longName = "x".repeat(200);
    renderItem({ id: 1, name: longName, archived: false }, cardView, {
      ...baseOpts,
      detail: "full",
      maxBytes: 0,
    });
    expect(streams.stderr).toBe("");
  });
});

describe("renderList — JSON format", () => {
  it("emits a list envelope with compact items", () => {
    const envelope: ListEnvelope<Card> = {
      data: [
        { id: 1, name: "Sales", archived: false },
        { id: 2, name: "Ops", archived: true },
      ],
      returned: 2,
      total: 2,
    };
    renderList(envelope, cardView, baseOpts);
    expect(parseJson(streams.stdout, CardListEnvelope)).toEqual({
      data: [
        { id: 1, name: "Sales" },
        { id: 2, name: "Ops" },
      ],
      returned: 2,
      total: 2,
    });
  });

  it("renders an empty list as an empty envelope", () => {
    renderList({ data: [], returned: 0, total: 0 }, cardView, baseOpts);
    expect(parseJson(streams.stdout, CardListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("truncates and emits a stderr notice when over the cap", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    const envelope: ListEnvelope<Card> = {
      data: items,
      returned: items.length,
      total: items.length,
    };
    renderList(envelope, cardView, { ...baseOpts, maxBytes: 500 });

    const projectedItems = items.map(({ id, name }) => ({ id, name }));
    const expectedCapped = capListEnvelope(
      { data: projectedItems, returned: items.length, total: items.length },
      500,
    );
    if (expectedCapped.truncated === undefined) {
      throw new Error("fixture should produce truncation");
    }

    expect(parseJson(streams.stdout, TruncatedEnvelope)).toEqual(expectedCapped);
    expect(streams.stderr).toBe(
      `… cut at ${expectedCapped.truncated.bytes} bytes; rerun with --max-bytes 0\n`,
    );
  });
});

describe("renderList — text format", () => {
  it("renders a table when data is non-empty", () => {
    const envelope: ListEnvelope<Card> = {
      data: [
        { id: 1, name: "Sales", archived: false },
        { id: 2, name: "Ops", archived: true },
      ],
      returned: 2,
      total: 2,
    };
    renderList(envelope, cardView, { ...baseOpts, format: "text" });
    expect(streams.stdout).toContain("ID");
    expect(streams.stdout).toContain("Name");
    expect(streams.stdout).toContain("Sales");
    expect(streams.stdout).toContain("Ops");
  });

  it("emits a single '(no results)' line when empty", () => {
    renderList({ data: [], returned: 0, total: 0 }, cardView, { ...baseOpts, format: "text" });
    expect(streams.stdout).toBe("(no results)\n");
  });

  it("falls back to JSON when detail=fields", () => {
    renderList(
      {
        data: [
          { id: 1, name: "Sales", archived: false },
          { id: 2, name: "Ops", archived: true },
        ],
        returned: 2,
        total: 2,
      },
      cardView,
      { ...baseOpts, format: "text", detail: "fields", fields: ["id", "archived"] },
    );
    expect(parseJson(streams.stdout, CardProjectedListEnvelope)).toEqual({
      data: [
        { id: 1, archived: false },
        { id: 2, archived: true },
      ],
      returned: 2,
      total: 2,
    });
  });

  it("writes truncation notice to stderr while keeping stdout the table", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    const envelope: ListEnvelope<Card> = {
      data: items,
      returned: items.length,
      total: items.length,
    };
    renderList(envelope, cardView, { ...baseOpts, format: "text", maxBytes: 500 });

    const expectedCapped = capListEnvelope(envelope, 500);
    if (expectedCapped.truncated === undefined) {
      throw new Error("fixture should produce truncation");
    }
    expect(streams.stdout).toContain("ID");
    expect(streams.stderr).toBe(
      `… cut at ${expectedCapped.truncated.bytes} bytes; rerun with --max-bytes 0\n`,
    );
  });
});
