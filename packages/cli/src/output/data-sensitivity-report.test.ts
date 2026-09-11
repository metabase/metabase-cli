import { describe, expect, it } from "vitest";

import type {
  DataSensitivityDatabaseResult,
  DataSensitivityFieldResult,
  DataSensitivityTableResult,
} from "@metabase/client/domain/data-sensitivity";

import { filterResult, formatDataSensitivityReport } from "./data-sensitivity-report";

const USAGE = {
  input_tokens: 1200,
  output_tokens: 90,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 1290,
};

interface FieldSpec {
  name: string;
  status: DataSensitivityFieldResult["status"];
  current: DataSensitivityFieldResult["current"];
  proposed: DataSensitivityFieldResult["proposed"];
  semantic_changed: boolean;
}

function field(spec: FieldSpec): DataSensitivityFieldResult {
  return {
    field_id: spec.name.length,
    name: spec.name,
    display_name: null,
    base_type: "type/Text",
    current: spec.current,
    proposed: spec.proposed,
    status: spec.status,
    semantic_changed: spec.semantic_changed,
  };
}

const ID = field({
  name: "ID",
  status: "agree",
  current: {
    data_sensitivity: "PUBLIC",
    human_set: false,
    state: "classifier",
    semantic_type: "type/PK",
  },
  proposed: {
    data_sensitivity: "PUBLIC",
    confidence: "high",
    semantic_type: "type/PK",
    reasoning: null,
  },
  semantic_changed: false,
});

const CITY = field({
  name: "CITY",
  status: "disagree",
  current: {
    data_sensitivity: "PUBLIC",
    human_set: false,
    state: "classifier",
    semantic_type: null,
  },
  proposed: { data_sensitivity: "PII", confidence: "high", semantic_type: null, reasoning: null },
  semantic_changed: false,
});

const EMAIL = field({
  name: "EMAIL",
  status: "new",
  current: { data_sensitivity: null, human_set: false, state: "unscanned", semantic_type: null },
  proposed: {
    data_sensitivity: "PII",
    confidence: "high",
    semantic_type: "type/Email",
    reasoning: null,
  },
  semantic_changed: true,
});

const NOTES = field({
  name: "NOTES",
  status: "abstain",
  current: {
    data_sensitivity: "PUBLIC",
    human_set: false,
    state: "classifier",
    semantic_type: null,
  },
  proposed: { data_sensitivity: null, confidence: "low", semantic_type: null, reasoning: null },
  semantic_changed: false,
});

const BLOB = field({
  name: "BLOB",
  status: "dropped",
  current: { data_sensitivity: null, human_set: false, state: "unscanned", semantic_type: null },
  proposed: { data_sensitivity: null, confidence: null, semantic_type: null, reasoning: null },
  semantic_changed: false,
});

const SSN = field({
  name: "SSN",
  status: "agree",
  current: { data_sensitivity: "PII", human_set: true, state: "human", semantic_type: "type/Name" },
  proposed: {
    data_sensitivity: "PII",
    confidence: "high",
    semantic_type: "type/Category",
    reasoning: null,
  },
  semantic_changed: true,
});

const PEOPLE: DataSensitivityTableResult = {
  table_id: 3,
  table_name: "PEOPLE",
  schema: "PUBLIC",
  database_id: 1,
  model: "anthropic/claude-haiku-4-5-20251001",
  requests: 1,
  usage: USAGE,
  sample_error: null,
  counts: { fields: 6, agree: 2, disagree: 1, new: 1, abstain: 1, dropped: 1, semantic_changed: 2 },
  fields: [ID, CITY, EMAIL, NOTES, BLOB, SSN],
};

const ORDERS_ERROR = {
  table_id: 4,
  table_name: "ORDERS",
  schema: null,
  error: "boom",
  error_code: "skipped",
};

const DATABASE: DataSensitivityDatabaseResult = {
  database_id: 1,
  schema: null,
  tables: [PEOPLE, ORDERS_ERROR],
  counts: PEOPLE.counts,
  usage: USAGE,
  requests: 1,
  failed: 1,
};

const TABLE_SUMMARY =
  "Scanned table PUBLIC.PEOPLE, 6 fields: 2 agree, 1 disagree, 1 new, 1 unsure, 1 no answer, 2 semantic type changes. 1 request, 1200 in / 90 out tokens.";

const DATABASE_SUMMARY =
  "Scanned 2 tables (1 failed), 6 fields: 2 agree, 1 disagree, 1 new, 1 unsure, 1 no answer, 2 semantic type changes. 1 request, 1200 in / 90 out tokens.";

describe("filterResult", () => {
  it("hands the result back untouched when no filter was asked for", () => {
    expect(filterResult(DATABASE, null)).toBe(DATABASE);
  });

  it("keeps only the fields whose status was asked for and leaves the counts as the server sent them", () => {
    expect(filterResult(PEOPLE, ["disagree", "new"])).toEqual({
      ...PEOPLE,
      fields: [CITY, EMAIL],
    });
  });

  it("filters every table's fields and keeps the table errors", () => {
    expect(filterResult(DATABASE, ["abstain"])).toEqual({
      ...DATABASE,
      tables: [{ ...PEOPLE, fields: [NOTES] }, ORDERS_ERROR],
    });
  });
});

describe("formatDataSensitivityReport", () => {
  it("breaks the input tokens down by cache bucket when the provider cached part of the prompt", () => {
    const cached = { ...PEOPLE, usage: { ...USAGE, cache_read_tokens: 1100 } };
    expect(formatDataSensitivityReport(cached, [])).toBe(
      TABLE_SUMMARY.replace("1200 in", "1200 in (0 cache write, 1100 cache read)"),
    );
  });

  it("shows every field with a changed label or semantic type when no filter was asked for", () => {
    expect(formatDataSensitivityReport(PEOPLE, null)).toBe(
      [
        TABLE_SUMMARY,
        "┌───────┬───────────┬────────────────┬──────────────────┐",
        "│ Field │ Base type │ Sensitivity    │ Semantic type    │",
        "├───────┼───────────┼────────────────┼──────────────────┤",
        "│ CITY  │ Text      │ PUBLIC -> PII  │                  │",
        "├───────┼───────────┼────────────────┼──────────────────┤",
        "│ EMAIL │ Text      │ -> PII         │ -> Email         │",
        "├───────┼───────────┼────────────────┼──────────────────┤",
        "│ NOTES │ Text      │ PUBLIC -> ?    │                  │",
        "├───────┼───────────┼────────────────┼──────────────────┤",
        "│ BLOB  │ Text      │ -> (no answer) │                  │",
        "├───────┼───────────┼────────────────┼──────────────────┤",
        "│ SSN   │ Text      │ PII*           │ Name -> Category │",
        "└───────┴───────────┴────────────────┴──────────────────┘",
        "* set by a person",
      ].join("\n"),
    );
  });

  it("adds the table column in database scope and renders a failed table as one row", () => {
    expect(formatDataSensitivityReport(DATABASE, ["agree"])).toBe(
      [
        DATABASE_SUMMARY,
        "┌───────────────┬───────┬───────────┬─────────────┬──────────────────┐",
        "│ Table         │ Field │ Base type │ Sensitivity │ Semantic type    │",
        "├───────────────┼───────┼───────────┼─────────────┼──────────────────┤",
        "│ PUBLIC.PEOPLE │ ID    │ Text      │ PUBLIC      │ PK               │",
        "├───────────────┼───────┼───────────┼─────────────┼──────────────────┤",
        "│ PUBLIC.PEOPLE │ SSN   │ Text      │ PII*        │ Name -> Category │",
        "├───────────────┼───────┼───────────┼─────────────┼──────────────────┤",
        "│ ORDERS        │       │           │ boom        │                  │",
        "└───────────────┴───────┴───────────┴─────────────┴──────────────────┘",
        "* set by a person",
      ].join("\n"),
    );
  });

  it("omits the footnote when no shown label was set by a person", () => {
    expect(formatDataSensitivityReport(PEOPLE, ["new"])).toBe(
      [
        TABLE_SUMMARY,
        "┌───────┬───────────┬─────────────┬───────────────┐",
        "│ Field │ Base type │ Sensitivity │ Semantic type │",
        "├───────┼───────────┼─────────────┼───────────────┤",
        "│ EMAIL │ Text      │ -> PII      │ -> Email      │",
        "└───────┴───────────┴─────────────┴───────────────┘",
      ].join("\n"),
    );
  });

  it("prints only the summary when no row survives the filter", () => {
    expect(formatDataSensitivityReport({ ...PEOPLE, fields: [ID] }, null)).toBe(TABLE_SUMMARY);
  });

  it("reports a failed sample on a table scan", () => {
    expect(
      formatDataSensitivityReport({ ...PEOPLE, fields: [ID], sample_error: "timeout" }, null),
    ).toBe(`${TABLE_SUMMARY} Sample values unavailable: timeout`);
  });
});
