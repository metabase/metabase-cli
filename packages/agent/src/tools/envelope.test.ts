import { expect, test } from "vitest";
import { buildListEnvelope, formatSteeringMessage, packUnits } from "./envelope";

test("formats the steering message naming the narrow and page parameters", () => {
  const message = formatSteeringMessage(143, {
    noun: "tables",
    context: "in schema `public`",
    narrowWith: ["schema"],
    pageWith: "offset",
  });
  expect(message).toBe("143 tables in schema `public` — narrow with `schema`, page with `offset`");
});

test("formats a steering message with no narrowing parameters", () => {
  const message = formatSteeringMessage(12, { noun: "databases", pageWith: "offset" });
  expect(message).toBe("12 databases — page with `offset`");
});

test("passes a fully-fitting page through with total and no truncation", () => {
  const envelope = buildListEnvelope([{ id: 1 }, { id: 2 }], {
    total: 2,
    steering: { noun: "cards", pageWith: "offset" },
  });
  expect(envelope).toEqual({ data: [{ id: 1 }, { id: 2 }], returned: 2, total: 2 });
});

test("flags a page-limited response when the server total exceeds the returned count", () => {
  const envelope = buildListEnvelope([{ id: 1 }, { id: 2 }], {
    total: 143,
    steering: {
      noun: "tables",
      context: "in schema `public`",
      narrowWith: ["schema"],
      pageWith: "offset",
    },
  });
  expect(envelope).toEqual({
    data: [{ id: 1 }, { id: 2 }],
    returned: 2,
    total: 143,
    truncated: {
      reason: "page_limit",
      message: "143 tables in schema `public` — narrow with `schema`, page with `offset`",
    },
  });
});

test("drops tail items past the byte cap and reports byte-cap truncation", () => {
  const items = [{ v: "a" }, { v: "b" }, { v: "c" }];
  const envelope = buildListEnvelope(items, {
    capBytes: 20,
    steering: { noun: "rows", pageWith: "offset" },
  });
  expect(envelope).toEqual({
    data: [{ v: "a" }],
    returned: 1,
    truncated: { reason: "byte_cap", message: "3 rows — page with `offset`" },
  });
});

test("packs complete units and names the omitted remainder", () => {
  const units = [
    { key: "ORDERS", items: [{ f: "id" }, { f: "total" }] },
    { key: "PRODUCTS", items: [{ f: "id" }, { f: "price" }] },
    { key: "PEOPLE", items: [{ f: "id" }] },
  ];
  const result = packUnits(units, { capBytes: 60 });
  expect(result).toEqual({
    included: [{ key: "ORDERS", items: [{ f: "id" }, { f: "total" }], offset: 0, total: 2 }],
    omittedKeys: ["PRODUCTS", "PEOPLE"],
  });
});

test("slices the first unit when it alone exceeds the budget", () => {
  const units = [{ key: "WIDE", items: [{ f: "a" }, { f: "b" }, { f: "c" }] }];
  const result = packUnits(units, { capBytes: 45 });
  expect(result).toEqual({
    included: [{ key: "WIDE", items: [{ f: "a" }], offset: 0, total: 3 }],
    omittedKeys: [],
  });
});

test("continues a single over-budget unit from the requested offset", () => {
  const units = [{ key: "WIDE", items: [{ f: "a" }, { f: "b" }, { f: "c" }] }];
  const result = packUnits(units, { capBytes: 45, startOffset: 1 });
  expect(result).toEqual({
    included: [{ key: "WIDE", items: [{ f: "b" }], offset: 1, total: 3 }],
    omittedKeys: [],
  });
});
