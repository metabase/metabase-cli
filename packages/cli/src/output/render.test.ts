import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { capListEnvelope } from "./cap";
import { renderSummary, renderItem, renderList, writeJson, writeText } from "./render";
import { renderTable } from "./table";
import {
  DEFAULT_MAX_BYTES,
  FULL_RANGE,
  listEnvelopeSchema,
  type ListEnvelope,
  type RenderOptions,
} from "./types";
import type { ResourceView } from "./view";
import { windowList } from "./window";

const Card = z.object({
  id: z.number().int(),
  name: z.string(),
  archived: z.boolean(),
});
type Card = z.infer<typeof Card>;

// What a `.loose()` domain schema hands the renderer: everything the view shows plus everything it
// does not.
interface RawCard extends Card {
  dataset_query: string;
}

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
  maxBytes: DEFAULT_MAX_BYTES,
};

const CardCompact = Card.pick({ id: true, name: true });
const CardProjected = Card.pick({ id: true, archived: true });
const TruncatedEnvelope = listEnvelopeSchema(CardCompact);
const CardListEnvelope = listEnvelopeSchema(CardCompact);
const CardProjectedListEnvelope = listEnvelopeSchema(CardProjected);

interface Streams {
  stdout: string;
  stderr: string;
}

let streams: Streams;

beforeEach(() => {
  streams = { stdout: "", stderr: "" };
  process.stdout.isTTY = false;
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
    const expectedBytes = Buffer.byteLength(JSON.stringify(item) + "\n", "utf8");
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
      `output is ${expectedBytes} bytes, over the 50-byte --max-bytes cap; narrow with --fields or raise the cap with --max-bytes <n>`,
    );
    expect(streams.stdout).toBe("");
  });

  it("surfaces the command-supplied oversize hint in the ConfigError message", () => {
    const longName = "x".repeat(200);
    const item: Card = { id: 1, name: longName, archived: false };
    const expectedBytes = Buffer.byteLength(JSON.stringify(item) + "\n", "utf8");
    const error = (() => {
      try {
        renderItem(item, cardView, {
          ...baseOpts,
          full: true,
          maxBytes: 50,
          oversizeHint: "use `mb card list` instead",
        });
      } catch (caught: unknown) {
        return caught;
      }
      throw new Error("expected renderItem to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      `output is ${expectedBytes} bytes, over the 50-byte --max-bytes cap; use \`mb card list\` instead`,
    );
  });

  it("does not throw when item fits inside maxBytes", () => {
    renderItem({ id: 1, name: "Sales", archived: false }, cardView, {
      ...baseOpts,
      maxBytes: DEFAULT_MAX_BYTES,
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
    const envelope = windowList(
      [
        { id: 1, name: "Sales", archived: false },
        { id: 2, name: "Ops", archived: true },
      ],
      FULL_RANGE,
    );
    renderList(envelope, cardView, baseOpts);
    expect(parseJson(streams.stdout, CardListEnvelope)).toEqual({
      data: [
        { id: 1, name: "Sales" },
        { id: 2, name: "Ops" },
      ],
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
    });
  });

  it("renders an empty list as an empty envelope", () => {
    renderList(windowList([], FULL_RANGE), cardView, baseOpts);
    expect(parseJson(streams.stdout, CardListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("truncates and emits a stderr notice when over the cap", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    const envelope = windowList(items, FULL_RANGE);
    renderList(envelope, cardView, { ...baseOpts, maxBytes: 500 });

    const projectedItems = items.map(({ id, name }) => ({ id, name }));
    const expectedCapped = capListEnvelope(windowList(projectedItems, FULL_RANGE), 500);
    assert(expectedCapped.truncated !== undefined, "fixture should produce truncation");

    expect(parseJson(streams.stdout, TruncatedEnvelope)).toEqual(expectedCapped);
    expect(streams.stderr).toBe(
      `… cut at ${expectedCapped.truncated.bytes} bytes; continue with --offset ${expectedCapped.next_offset}, narrow the selection or raise --max-bytes\n`,
    );
  });

  it("emits an empty window and the command-supplied hint when no row fits the cap", () => {
    const item = { id: 1, name: "x".repeat(400), archived: false };
    const envelope = windowList([item], FULL_RANGE);
    const fullBytes = Buffer.byteLength(
      JSON.stringify(windowList([{ id: item.id, name: item.name }], FULL_RANGE)),
      "utf8",
    );

    renderList(envelope, cardView, {
      ...baseOpts,
      maxBytes: 100,
      oversizeHint: "pass --max-bytes 0 to print it whole",
    });

    expect(parseJson(streams.stdout, TruncatedEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 1,
      has_more: true,
      next_offset: null,
      truncated: { reason: "max_bytes", bytes: fullBytes },
    });
    expect(streams.stderr).toBe(
      `… cut at ${fullBytes} bytes; pass --max-bytes 0 to print it whole\n`,
    );
  });

  it("serializes envelope metadata before data so a tail cut cannot hide truncation", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    renderList(windowList(items, FULL_RANGE), cardView, {
      ...baseOpts,
      maxBytes: 500,
    });

    const projectedItems = items.map(({ id, name }) => ({ id, name }));
    const expectedCapped = capListEnvelope(windowList(projectedItems, FULL_RANGE), 500);
    assert(expectedCapped.truncated !== undefined, "fixture should produce truncation");
    const prefix = `{"returned":${expectedCapped.returned},"offset":${expectedCapped.offset},"total":${expectedCapped.total},"has_more":${expectedCapped.has_more},"next_offset":${expectedCapped.next_offset},"truncated":{"reason":"max_bytes","bytes":${expectedCapped.truncated.bytes}},"data":[`;
    expect(streams.stdout.slice(0, prefix.length)).toBe(prefix);
  });
});

describe("renderList — text format", () => {
  it("renders a table when data is non-empty", () => {
    const envelope = windowList(
      [
        { id: 1, name: "Sales", archived: false },
        { id: 2, name: "Ops", archived: true },
      ],
      FULL_RANGE,
    );
    renderList(envelope, cardView, { ...baseOpts, format: "text" });
    expect(streams.stdout).toContain("ID");
    expect(streams.stdout).toContain("Name");
    expect(streams.stdout).toContain("Sales");
    expect(streams.stdout).toContain("Ops");
  });

  it("emits a single '(no results)' line when empty", () => {
    renderList(windowList([], FULL_RANGE), cardView, { ...baseOpts, format: "text" });
    expect(streams.stdout).toBe("(no results)\n");
  });

  it("renders a projected table (columns = the requested field paths) when fields is set in text mode", () => {
    renderList(
      windowList(
        [
          { id: 1, name: "Sales", archived: false },
          { id: 2, name: "Ops", archived: true },
        ],
        FULL_RANGE,
      ),
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
      windowList(
        [
          { id: 1, name: "Sales", archived: false },
          { id: 2, name: "Ops", archived: true },
        ],
        FULL_RANGE,
      ),
      cardView,
      { ...baseOpts, fields: ["id", "archived"] },
    );
    expect(parseJson(streams.stdout, CardProjectedListEnvelope)).toEqual({
      data: [
        { id: 1, archived: false },
        { id: 2, archived: true },
      ],
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
    });
  });

  it("writes truncation notice to stderr while keeping stdout the table", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    const envelope = windowList(items, FULL_RANGE);
    renderList(envelope, cardView, { ...baseOpts, format: "text", maxBytes: 500 });

    const projectedItems = items.map(({ id, name }) => ({ id, name }));
    const expectedCapped = capListEnvelope(windowList(projectedItems, FULL_RANGE), 500);
    assert(expectedCapped.truncated !== undefined, "fixture should produce truncation");
    expect(streams.stdout).toContain("ID");
    expect(streams.stderr).toBe(
      `… cut at ${expectedCapped.truncated.bytes} bytes; continue with --offset ${expectedCapped.next_offset}, narrow the selection or raise --max-bytes\n`,
    );
  });

  it("prints a header-only table and reports the cut when not even one row fits the cap", () => {
    const item: Card = { id: 1, name: "x".repeat(400), archived: false };
    const envelope = windowList([item], FULL_RANGE);

    renderList(envelope, cardView, { ...baseOpts, format: "text", maxBytes: 100 });

    const fullBytes = Buffer.byteLength(
      JSON.stringify(windowList([{ id: item.id, name: item.name }], FULL_RANGE)),
      "utf8",
    );
    expect(streams.stdout).toBe(renderTable([], cardView.tableColumns) + "\n");
    expect(streams.stderr).toBe(
      `… cut at ${fullBytes} bytes; narrow the selection or raise --max-bytes\n`,
    );
  });

  it("spends the budget on the projection, so bulk the table never prints costs no rows", () => {
    const items: RawCard[] = Array.from({ length: 3 }, (_, index) => ({
      id: index,
      name: `card-${index}`,
      archived: false,
      dataset_query: "q".repeat(5_000),
    }));
    const envelope: ListEnvelope<Card> = windowList(items, FULL_RANGE);

    renderList(envelope, cardView, { ...baseOpts, format: "text", maxBytes: 500 });

    expect(streams.stdout).toBe(renderTable(items, cardView.tableColumns) + "\n");
    expect(streams.stderr).toBe("");
  });

  it("cuts a text table at the same row its --json equivalent cuts, rendering the raw items", () => {
    const items: Card[] = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      name: `card-${"x".repeat(40)}-${index}`,
      archived: false,
    }));
    const envelope = windowList(items, FULL_RANGE);

    renderList(envelope, cardView, { ...baseOpts, maxBytes: 500 });
    const jsonEnvelope = parseJson(streams.stdout, TruncatedEnvelope);
    streams.stdout = "";
    renderList(envelope, cardView, { ...baseOpts, format: "text", maxBytes: 500 });

    expect(streams.stdout).toBe(
      renderTable(items.slice(0, jsonEnvelope.returned), cardView.tableColumns) + "\n",
    );
  });
});

describe("renderList — --fields path errors", () => {
  const envelope = windowList([{ id: 1, name: "Sales", archived: false }], FULL_RANGE);

  function renderListError(opts: RenderOptions): ConfigError {
    try {
      renderList(envelope, cardView, opts);
    } catch (error) {
      assert(error instanceof ConfigError, "expected a ConfigError");
      return error;
    }
    throw new Error("expected renderList to throw");
  }

  it("enriches an envelope-relative `data.` path with the item-relative hint (json)", () => {
    const { message } = renderListError({ ...baseOpts, fields: ["data.id"] });
    expect(message).toContain("relative to each item in `data`");
    expect(message).toContain("use `id` instead of `data.id`");
  });

  it("enriches a `data.` path in text mode too", () => {
    const { message } = renderListError({ ...baseOpts, format: "text", fields: ["data.name"] });
    expect(message).toContain("use `name` instead of `data.name`");
  });

  it("leaves an ordinary unknown-path error unchanged", () => {
    const { message } = renderListError({ ...baseOpts, fields: ["nope"] });
    expect(message).toBe('unknown field path: "nope"');
  });
});

describe("writeJson", () => {
  it("emits single-line JSON with a trailing newline when stdout is not a TTY", () => {
    writeJson({ a: 1, b: ["x", "y"] });
    expect(streams.stdout).toBe('{"a":1,"b":["x","y"]}\n');
  });

  it("pretty-prints when stdout is a TTY", () => {
    process.stdout.isTTY = true;
    try {
      writeJson({ a: 1, b: ["x", "y"] });
    } finally {
      process.stdout.isTTY = false;
    }
    expect(streams.stdout).toBe('{\n  "a": 1,\n  "b": [\n    "x",\n    "y"\n  ]\n}\n');
  });
});

describe("writeText", () => {
  it("appends a single trailing newline to the input", () => {
    writeText("hello\nworld");
    expect(streams.stdout).toBe("hello\nworld\n");
  });
});
