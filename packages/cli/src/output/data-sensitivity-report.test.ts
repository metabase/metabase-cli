import { describe, expect, it } from "vitest";

import type {
  DataSensitivityDatabaseResult,
  DataSensitivityFieldResult,
  DataSensitivityTableResult,
} from "@metabase/client/domain/data-sensitivity";

import {
  DEFAULT_TEXT_STATUSES,
  filterDatabaseResult,
  filterTableResult,
  flattenRows,
  formatDataSensitivityReport,
} from "./data-sensitivity-report";

const USAGE = {
  input_tokens: 1200,
  output_tokens: 90,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
};

function field(
  name: string,
  status: DataSensitivityFieldResult["status"],
  current: DataSensitivityFieldResult["current"]["data_sensitivity"],
  proposed: DataSensitivityFieldResult["proposed"]["data_sensitivity"],
): DataSensitivityFieldResult {
  return {
    field_id: name.length,
    name,
    display_name: null,
    base_type: "type/Text",
    current: {
      data_sensitivity: current,
      human_set: false,
      state: "classifier",
      semantic_type: null,
    },
    proposed: {
      data_sensitivity: proposed,
      confidence: proposed === null ? null : "high",
      semantic_type: null,
      reasoning: null,
    },
    status,
    semantic_changed: false,
  };
}

const PEOPLE: DataSensitivityTableResult = {
  table_id: 3,
  table_name: "PEOPLE",
  schema: "PUBLIC",
  database_id: 1,
  model: "anthropic/claude-haiku-4-5-20251001",
  requests: 1,
  usage: USAGE,
  sample_error: null,
  counts: { fields: 3, agree: 1, disagree: 1, new: 0, abstain: 1, dropped: 0, semantic_changed: 0 },
  fields: [
    field("ID", "agree", "PUBLIC", "PUBLIC"),
    field("CITY", "disagree", "PUBLIC", "PII"),
    field("NOTES", "abstain", "PUBLIC", null),
  ],
};

const DATABASE: DataSensitivityDatabaseResult = {
  database_id: 1,
  schema: null,
  tables: [
    PEOPLE,
    { table_id: 4, table_name: "ORDERS", schema: null, error: "boom", error_code: "skipped" },
  ],
  counts: PEOPLE.counts,
  usage: USAGE,
  requests: 1,
  failed: 1,
};

const SUMMARY =
  "Scanned 2 tables (1 failed), 3 fields: 1 agree, 1 disagree, 0 new, 1 unsure, 0 no answer. 1 request, 1200 in / 90 out tokens.";

describe("DEFAULT_TEXT_STATUSES", () => {
  it("is every status but agree", () => {
    expect(DEFAULT_TEXT_STATUSES).toEqual(["disagree", "new", "abstain", "dropped"]);
  });
});

describe("flattenRows", () => {
  it("emits one row per field and one error row per failed table", () => {
    expect(flattenRows(DATABASE)).toEqual([
      {
        table: "PUBLIC.PEOPLE",
        field: "ID",
        base_type: "type/Text",
        current: "PUBLIC",
        proposed: "PUBLIC",
        confidence: "high",
        status: "agree",
      },
      {
        table: "PUBLIC.PEOPLE",
        field: "CITY",
        base_type: "type/Text",
        current: "PUBLIC",
        proposed: "PII",
        confidence: "high",
        status: "disagree",
      },
      {
        table: "PUBLIC.PEOPLE",
        field: "NOTES",
        base_type: "type/Text",
        current: "PUBLIC",
        proposed: null,
        confidence: null,
        status: "abstain",
      },
      {
        table: "ORDERS",
        field: null,
        base_type: null,
        current: null,
        proposed: "boom",
        confidence: null,
        status: "error",
      },
    ]);
  });
});

describe("filterTableResult", () => {
  it("keeps only the fields whose status was asked for and leaves the counts as the server sent them", () => {
    expect(filterTableResult(PEOPLE, ["disagree"])).toEqual({
      ...PEOPLE,
      fields: [field("CITY", "disagree", "PUBLIC", "PII")],
    });
  });
});

describe("filterDatabaseResult", () => {
  it("hands the result back untouched when no filter was asked for", () => {
    expect(filterDatabaseResult(DATABASE, null)).toBe(DATABASE);
  });

  it("filters every table's fields and keeps the table errors", () => {
    expect(filterDatabaseResult(DATABASE, ["abstain"])).toEqual({
      ...DATABASE,
      tables: [
        { ...PEOPLE, fields: [field("NOTES", "abstain", "PUBLIC", null)] },
        { table_id: 4, table_name: "ORDERS", schema: null, error: "boom", error_code: "skipped" },
      ],
    });
  });
});

describe("filterTableResult (no filter)", () => {
  it("hands the result back untouched when no filter was asked for", () => {
    expect(filterTableResult(PEOPLE, null)).toBe(PEOPLE);
  });
});

describe("formatDataSensitivityReport", () => {
  it("leaves the agreed fields out when no filter was asked for", () => {
    expect(formatDataSensitivityReport(DATABASE, null)).toBe(
      [
        SUMMARY,
        "┌───────────────┬───────┬───────────┬─────────┬──────────┬────────────┬──────────┐",
        "│ Table         │ Field │ Type      │ Current │ Proposed │ Confidence │ Status   │",
        "├───────────────┼───────┼───────────┼─────────┼──────────┼────────────┼──────────┤",
        "│ PUBLIC.PEOPLE │ CITY  │ type/Text │ PUBLIC  │ PII      │ high       │ disagree │",
        "├───────────────┼───────┼───────────┼─────────┼──────────┼────────────┼──────────┤",
        "│ PUBLIC.PEOPLE │ NOTES │ type/Text │ PUBLIC  │          │            │ abstain  │",
        "├───────────────┼───────┼───────────┼─────────┼──────────┼────────────┼──────────┤",
        "│ ORDERS        │       │           │         │ boom     │            │ error    │",
        "└───────────────┴───────┴───────────┴─────────┴──────────┴────────────┴──────────┘",
      ].join("\n"),
    );
  });

  it("leads with the server totals and tables only the requested statuses plus errors", () => {
    expect(formatDataSensitivityReport(DATABASE, ["disagree"])).toBe(
      [
        SUMMARY,
        "┌───────────────┬───────┬───────────┬─────────┬──────────┬────────────┬──────────┐",
        "│ Table         │ Field │ Type      │ Current │ Proposed │ Confidence │ Status   │",
        "├───────────────┼───────┼───────────┼─────────┼──────────┼────────────┼──────────┤",
        "│ PUBLIC.PEOPLE │ CITY  │ type/Text │ PUBLIC  │ PII      │ high       │ disagree │",
        "├───────────────┼───────┼───────────┼─────────┼──────────┼────────────┼──────────┤",
        "│ ORDERS        │       │           │         │ boom     │            │ error    │",
        "└───────────────┴───────┴───────────┴─────────┴──────────┴────────────┴──────────┘",
      ].join("\n"),
    );
  });

  it("prints only the summary when no row survives the filter", () => {
    expect(formatDataSensitivityReport(PEOPLE, ["new"])).toBe(
      "Scanned table PUBLIC.PEOPLE, 3 fields: 1 agree, 1 disagree, 0 new, 1 unsure, 0 no answer. 1 request, 1200 in / 90 out tokens.",
    );
  });

  it("reports a failed sample on a table scan", () => {
    expect(formatDataSensitivityReport({ ...PEOPLE, sample_error: "timeout" }, ["new"])).toBe(
      "Scanned table PUBLIC.PEOPLE, 3 fields: 1 agree, 1 disagree, 0 new, 1 unsure, 0 no answer. 1 request, 1200 in / 90 out tokens. Sample values unavailable: timeout",
    );
  });
});
