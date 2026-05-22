import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ConfigError } from "../core/errors";
import type { ResourceView } from "../domain/view";
import { parseJson } from "../runtime/json";
import { capListEnvelope } from "./cap";
import { renderSummary, renderItem, renderList, writeJson, writeText } from "./render";
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
  full: false,
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

  it("emits the full item when full=true", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      full: true,
    });
    expect(parseJson(streams.stdout, Card)).toEqual({ id: 1, name: "Sales", archived: false });
  });

  it("emits a fields projection as JSON when fields is set and format is json", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      fields: ["id", "archived"],
    });
    expect(parseJson(streams.stdout, CardProjected)).toEqual({ id: 1, archived: false });
  });

  it("renders the fields projection as key/value lines in text mode", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      format: "text",
      fields: ["id", "archived"],
    });
    expect(streams.stdout).toBe("id        1\narchived  false\n");
  });

  it("renders text mode as label/value lines using tableColumns", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      format: "text",
    });
    expect(streams.stdout).toBe("ID    1\nName  Sales\n");
  });

  it("includes every field in text mode when full=true", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      format: "text",
      full: true,
    });
    expect(streams.stdout).toBe("id        1\nname      Sales\narchived  false\n");
  });

  it("throws ConfigError and writes nothing when a single item exceeds maxBytes", () => {
    const longName = "x".repeat(200);
    const item: Card = { id: 1, name: longName, archived: false };
    const expectedBytes = Buffer.byteLength(JSON.stringify(item, null, 2) + "\n", "utf8");
    const error = (() => {
      try {
        renderItem(item, cardView, { ...baseOpts, full: true, maxBytes: 50 });
      } catch (caught: unknown) {
        return caught;
      }
      throw new Error("expected renderItem to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      `output is ${expectedBytes} bytes, over the 50-byte --max-bytes cap; narrow with --fields, or pass --max-bytes 0 to disable`,
    );
    expect(error.exitCode).toBe(2);
    expect(streams.stdout).toBe("");
  });

  it("does not throw when item fits inside maxBytes", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      maxBytes: 65536,
    });
    expect(streams.stderr).toBe("");
  });

  it("does not cap a single item when maxBytes is 0", () => {
    const longName = "x".repeat(200);
    const item: Card = { id: 1, name: longName, archived: false };
    renderItem(item, cardView, {
      ...baseOpts,
      full: true,
      maxBytes: 0,
    });
    expect(parseJson(streams.stdout, Card)).toEqual(item);
    expect(streams.stderr).toBe("");
  });
});

describe("renderSummary", () => {
  it("prints the bare human text in text mode", () => {
    renderSummary({ id: 1, name: "Sales", archived: false }, cardView, "Sales", {
      ...baseOpts,
      format: "text",
    });
    expect(streams.stdout).toBe("Sales\n");
  });

  it("emits the keyed compact envelope in JSON mode, ignoring the human text", () => {
    renderSummary({ id: 1, name: "Sales", archived: false }, cardView, "Sales", baseOpts);
    expect(parseJson(streams.stdout, CardCompact)).toEqual({ id: 1, name: "Sales" });
  });

  it("falls back to the keyed object in text mode when full=true", () => {
    renderSummary({ id: 1, name: "Sales", archived: false }, cardView, "Sales", {
      ...baseOpts,
      format: "text",
      full: true,
    });
    expect(streams.stdout).toBe("id        1\nname      Sales\narchived  false\n");
  });

  it("falls back to the fields projection (as text key/value lines) when fields is set in text mode", () => {
    renderSummary({ id: 1, name: "Sales", archived: false }, cardView, "Sales", {
      ...baseOpts,
      format: "text",
      fields: ["id", "archived"],
    });
    expect(streams.stdout).toBe("id        1\narchived  false\n");
  });

  it("falls back to the fields projection as JSON when fields is set under --json", () => {
    renderSummary({ id: 1, name: "Sales", archived: false }, cardView, "Sales", {
      ...baseOpts,
      fields: ["id", "archived"],
    });
    expect(parseJson(streams.stdout, CardProjected)).toEqual({ id: 1, archived: false });
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
    assert(expectedCapped.truncated !== undefined, "fixture should produce truncation");

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

  it("renders a projected table (columns = the requested field paths) when fields is set in text mode", () => {
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
      { ...baseOpts, format: "text", fields: ["id", "archived"] },
    );
    expect(streams.stdout).toBe(
      `┌────┬──────────┐
│ id │ archived │
├────┼──────────┤
│ 1  │ false    │
├────┼──────────┤
│ 2  │ true     │
└────┴──────────┘
`,
    );
  });

  it("emits the projected list as JSON when fields is set under --json", () => {
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
      { ...baseOpts, fields: ["id", "archived"] },
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
    assert(expectedCapped.truncated !== undefined, "fixture should produce truncation");
    expect(streams.stdout).toContain("ID");
    expect(streams.stderr).toBe(
      `… cut at ${expectedCapped.truncated.bytes} bytes; rerun with --max-bytes 0\n`,
    );
  });
});

describe("writeJson", () => {
  it("emits the value pretty-printed with a trailing newline", () => {
    writeJson({ a: 1, b: ["x", "y"] });
    expect(streams.stdout).toBe('{\n  "a": 1,\n  "b": [\n    "x",\n    "y"\n  ]\n}\n');
  });
});

describe("writeText", () => {
  it("appends a single trailing newline to the input", () => {
    writeText("hello\nworld");
    expect(streams.stdout).toBe("hello\nworld\n");
  });
});
