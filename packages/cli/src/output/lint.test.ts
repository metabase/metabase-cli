import { describe, expect, it } from "vitest";

import { InternalError } from "@metabase/client/errors";
import type { LintReport, LintResult } from "@metabase/client/domain/lint";

import { lintReportLines } from "./lint";

const TRANSFORM_ID = "Tf9pQ2wLmX7sYb4nC8dE1";
const CARD_ID = "Cd7kW2pLmX7sYb4nC8dE1";

const MISSING_COLUMN: LintResult = {
  ruleId: "missing-column",
  entity_id: CARD_ID,
  message: 'Column TOTAL is not on card "Orders model"',
  detail: "TOTAL",
  cause: null,
};

const ANALYSIS_FAILED: LintResult = {
  ruleId: "validation-exception-error",
  entity_id: CARD_ID,
  message: "Metabase could not check this entity: timed out",
  detail: "timed out",
  cause: null,
};

const MISSING_TABLE_ALIAS: LintResult = {
  ruleId: "missing-table-alias",
  entity_id: TRANSFORM_ID,
  message: "Native SQL reads ORDERZ, which no known table matches",
  detail: "ORDERZ",
  cause: null,
};

// The server marks every rule an error; a warning rule pins how the text marks one.
const RULES = {
  "missing-column": {
    severity: "error",
    description: "A query reads a column its source does not have.",
  },
  "missing-table-alias": {
    severity: "error",
    description: "Native SQL names a table that matches no table Metabase knows.",
  },
  "validation-exception-error": {
    severity: "warning",
    description: "Metabase could not check the entity.",
  },
} as const;

const ENTITIES = {
  [CARD_ID]: { id: 310, type: "card", data: { name: "Revenue by day", collection_id: 5 } },
  [TRANSFORM_ID]: {
    id: 17,
    type: "transform",
    data: { name: "Orders daily", collection_id: null },
  },
} as const;

// The server's severities: every rule is an error.
const SERVER_RULES = {
  "missing-column": RULES["missing-column"],
  "missing-table-alias": RULES["missing-table-alias"],
  "validation-exception-error": {
    severity: "error",
    description: "The analysis of the query failed.",
  },
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
    expect(lintReportLines(PASSED)).toEqual(["PASSED  no violations"]);
  });

  it("aligns the rules of each entity, with the verdict and counts", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 2, warnings: 1, entities: 2 },
      entities: ENTITIES,
      rules: RULES,
      results: [MISSING_TABLE_ALIAS, MISSING_COLUMN, ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `✗ transform "Orders daily" ${TRANSFORM_ID}`,
      "    missing-table-alias  Native SQL reads ORDERZ, which no known table matches",
      `✗ card "Revenue by day" ${CARD_ID}`,
      '    missing-column              Column TOTAL is not on card "Orders model"',
      "    validation-exception-error  Metabase could not check this entity: timed out",
      "FAILED  2 errors, 1 warning in 2 entities",
    ]);
  });

  it("marks an entity whose results are all warnings with `!`", () => {
    const report: LintReport = {
      status: "passed",
      summary: { errors: 0, warnings: 1, entities: 1 },
      entities: ENTITIES,
      rules: RULES,
      results: [ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `! card "Revenue by day" ${CARD_ID}`,
      "    validation-exception-error  Metabase could not check this entity: timed out",
      "PASSED  1 warning in 1 entity",
    ]);
  });

  it("refuses a result naming a rule the report does not describe", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
      entities: ENTITIES,
      rules: {},
      results: [MISSING_COLUMN],
    };
    expect(() => lintReportLines(report)).toThrow(InternalError);
    expect(() => lintReportLines(report)).toThrow(
      "Lint report from Metabase is missing rule missing-column.",
    );
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
      `Lint report from Metabase is missing entity ${CARD_ID}.`,
    );
  });

  it("groups interleaved results under one heading per entity, in first-seen order", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 3, warnings: 0, entities: 2 },
      entities: ENTITIES,
      rules: SERVER_RULES,
      results: [MISSING_COLUMN, MISSING_TABLE_ALIAS, ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `✗ card "Revenue by day" ${CARD_ID}`,
      '    missing-column              Column TOTAL is not on card "Orders model"',
      "    validation-exception-error  Metabase could not check this entity: timed out",
      `✗ transform "Orders daily" ${TRANSFORM_ID}`,
      "    missing-table-alias  Native SQL reads ORDERZ, which no known table matches",
      "FAILED  3 errors in 2 entities",
    ]);
  });

  it("marks every entity of an errors-only report with ✗ and counts only errors", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 2, warnings: 0, entities: 2 },
      entities: ENTITIES,
      rules: SERVER_RULES,
      results: [MISSING_TABLE_ALIAS, ANALYSIS_FAILED],
    };
    expect(lintReportLines(report)).toEqual([
      `✗ transform "Orders daily" ${TRANSFORM_ID}`,
      "    missing-table-alias  Native SQL reads ORDERZ, which no known table matches",
      `✗ card "Revenue by day" ${CARD_ID}`,
      "    validation-exception-error  Metabase could not check this entity: timed out",
      "FAILED  2 errors in 2 entities",
    ]);
  });

  it("prints control characters in a name or a message escaped", () => {
    const report: LintReport = {
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
      entities: {
        [CARD_ID]: {
          id: 7,
          type: "card",
          data: { name: "Revenue\n\u001b[2K\rPASSED  no violations", collection_id: 3 },
        },
      },
      rules: SERVER_RULES,
      results: [{ ...MISSING_COLUMN, message: "Column TOTAL is missing\u001b[8m" }],
    };
    expect(lintReportLines(report)).toEqual([
      `✗ card "Revenue\\u000a\\u001b[2K\\u000dPASSED  no violations" ${CARD_ID}`,
      "    missing-column  Column TOTAL is missing\\u001b[8m",
      "FAILED  1 error in 1 entity",
    ]);
  });
});
