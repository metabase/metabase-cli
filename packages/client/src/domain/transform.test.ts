import { describe, expect, it } from "vitest";

import { evaluateFeatures } from "../version/features";

import {
  isTransformRunFailed,
  isTransformRunTerminal,
  transformDetailSchema,
  transformRowSchema,
  type TransformRunStatus,
} from "./transform";

const ALL_STATUSES: TransformRunStatus[] = [
  "started",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "canceling",
];

describe("isTransformRunTerminal", () => {
  it("returns false for the two in-flight statuses, started and canceling", () => {
    const terminal = ALL_STATUSES.filter((status) => isTransformRunTerminal(status));
    expect(terminal).toEqual(["succeeded", "failed", "timeout", "canceled"]);
  });
});

describe("isTransformRunFailed", () => {
  it("returns true only for failed, timeout, and canceled (not succeeded)", () => {
    const failures = ALL_STATUSES.filter((status) => isTransformRunFailed(status));
    expect(failures).toEqual(["failed", "timeout", "canceled"]);
  });
});

const HYDRATED_TABLE_SERVER = evaluateFeatures(59, null);

const ROW = {
  id: 7,
  name: "Daily orders",
  description: null,
  source: { type: "query", query: { database: 1, type: "native", native: { query: "select 1" } } },
  target: { type: "table", database: 1, schema: "public", name: "daily_orders" },
  source_type: "native",
  entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  creator_id: 1,
  collection_id: null,
  creator: { id: 1, email: "admin@example.com" },
};

describe("transformDetailSchema", () => {
  it("reads the hydrated table's id into target_table_id and keeps the table every detail carries", () => {
    const table = { id: 42, name: "daily_orders", schema: "public" };

    expect(transformDetailSchema(HYDRATED_TABLE_SERVER).parse({ ...ROW, table })).toEqual({
      ...ROW,
      table,
      target_table_id: 42,
    });
  });

  it("reads a hydrated null table as no target table yet", () => {
    expect(transformDetailSchema(HYDRATED_TABLE_SERVER).parse({ ...ROW, table: null })).toEqual({
      ...ROW,
      table: null,
      target_table_id: null,
    });
  });
});

describe("transformRowSchema", () => {
  it("answers no target table for a row from a server that links it on the detail alone", () => {
    expect(transformRowSchema(HYDRATED_TABLE_SERVER).parse(ROW)).toEqual({
      ...ROW,
      target_table_id: null,
    });
  });
});
