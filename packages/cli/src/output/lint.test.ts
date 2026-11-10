import { describe, expect, it } from "vitest";

import { InternalError } from "@metabase/client/errors";
import type { LintReport, LintResult } from "@metabase/client/domain/lint";

import { lintReportLines } from "./lint";

const MODEL_ID = "Tf9pQ2wLmX7sYb4nC8dE1";
const CARD_ID = "Cd7kW2pLmX7sYb4nC8dE1";

const MISSING_COLUMN: LintResult = {
  ruleId: "missing-column",
  entity_id: CARD_ID,
  message: 'Column TOTAL is not on card "Orders model"',
  detail: "TOTAL",
  cause: { type: "card", id: 17, entity_id: MODEL_ID, name: "Orders model" },
};

const ANALYSIS_FAILED: LintResult = {
  ruleId: "validation-exception-error",
  entity_id: CARD_ID,
  message: "The analysis failed: timed out",
  detail: "timed out",
  cause: null,
};

const MISSING_TABLE_ALIAS: LintResult = {
  ruleId: "missing-table-alias",
  entity_id: MODEL_ID,
  message: "Native SQL reads ORDERZ, which no known table matches",
  detail: "ORDERZ",
  cause: null,
};

const RULES = {
  "missing-column": {
    severity: "error",
    description: "A query reads a column its source does not have.",
  },
  "missing-table-alias": {
    severity: "error",
    description: "Native SQL reads a table no known table matches.",
  },
  "validation-exception-error": {
    severity: "warning",
    description: "The analysis of the query failed.",
  },
} as const;

const ENTITIES = {
  [CARD_ID]: { id: 310, type: "card", data: { name: "Revenue by day", collection_id: 5 } },
  [MODEL_ID]: { id: 17, type: "transform", data: { name: "Orders daily", collection_id: null } },
} as const;

const PASSED: LintReport = {
  status: "passed",
  summary: { errors: 0, warnings: 0, entities: 0 },
  entities: {},
  rules: {},
  results: [],
};

describe("lintReportLines", () => {
  it("renders a clean report as the verdict alone", () => {
    expect(lintReportLines(PASSED)).toEqual(["PASSED  no broken queries"]);
  });

  it("groups results under their entity, rules aligned, and counts the verdict", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 2, warnings: 1, entities: 2 },
      entities: ENTITIES,
      rules: RULES,
      results: [MISSING_TABLE_ALIAS, MISSING_COLUMN, ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `✗ transform "Orders daily" ${MODEL_ID}`,
      "    missing-table-alias  Native SQL reads ORDERZ, which no known table matches",
      `✗ card "Revenue by day" ${CARD_ID}`,
      '    missing-column              Column TOTAL is not on card "Orders model"',
      "    validation-exception-error  The analysis failed: timed out",
      "FAILED  2 errors, 1 warning in 2 entities",
    ]);
  });

  it("marks an entity with only warnings and passes it", () => {
    const report: LintReport = {
      status: "passed",
      summary: { errors: 0, warnings: 1, entities: 1 },
      entities: ENTITIES,
      rules: RULES,
      results: [ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `! card "Revenue by day" ${CARD_ID}`,
      "    validation-exception-error  The analysis failed: timed out",
      "PASSED  1 warning in 1 entity",
    ]);
  });

  it("treats a rule the report does not describe as a warning", () => {
    const report: LintReport = {
      status: "passed",
      summary: { errors: 0, warnings: 0, entities: 1 },
      entities: ENTITIES,
      rules: {},
      results: [MISSING_COLUMN],
    };
    expect(lintReportLines(report)[0]).toBe(`! card "Revenue by day" ${CARD_ID}`);
  });

  it("refuses a result naming an entity the report does not carry", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
      entities: {},
      rules: RULES,
      results: [MISSING_COLUMN],
    };
    expect(() => lintReportLines(report)).toThrow(InternalError);
    expect(() => lintReportLines(report)).toThrow(
      `lint result names entity ${CARD_ID}, which the report does not carry`,
    );
  });
});
