import { describe, expect, it } from "vitest";

import type { LintReport, LintResult } from "@metabase/client/domain/lint";
import { InternalError, TimeoutError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import { brokenRefChecks, reportStop } from "./ci-broken-refs";
import { NotAuthenticatedError } from "./config";

const CARD_ID = "Cd7kW2pLmX7sYb4nC8dE1";
const INSTANCE_CHECK = {
  kind: "broken-refs",
  id: "instance",
  label: "Saved queries on the instance",
};

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
  message: "The analysis failed: timed out",
  detail: "timed out",
  cause: null,
};

const CARD = { id: 310, type: "card", data: { name: "Revenue by day", collection_id: 5 } } as const;

const RULES = {
  "missing-column": {
    severity: "error",
    description: "A query reads a column its source does not have.",
  },
  "validation-exception-error": {
    severity: "warning",
    description: "The analysis of the query failed.",
  },
} as const;

function reportOf(status: LintReport["status"], results: LintResult[]): LintReport {
  return {
    status,
    summary: { errors: status === "failed" ? 1 : 0, warnings: 1, entities: 1 },
    entities: { [CARD_ID]: CARD },
    rules: RULES,
    results,
  };
}

describe("brokenRefChecks", () => {
  it("passes one check for an instance with no finding, carrying how long the report took", () => {
    const summary = { errors: 0, warnings: 0, entities: 0 };
    const clean: LintReport = { status: "passed", summary, entities: {}, rules: {}, results: [] };

    expect(brokenRefChecks(clean, 42)).toEqual([
      { check: INSTANCE_CHECK, verdict: "passed", warnings: [], ms: 42, detail: summary },
    ]);
  });

  it("fails an entity with an error, keeping its warning results as warnings", () => {
    expect(brokenRefChecks(reportOf("failed", [MISSING_COLUMN, ANALYSIS_FAILED]), 42)).toEqual([
      {
        check: { kind: "broken-refs", id: CARD_ID, label: 'card "Revenue by day"' },
        verdict: "failed",
        warnings: [
          { code: "validation-exception-error", message: "The analysis failed: timed out" },
        ],
        ms: 0,
        detail: { entity: CARD, errors: [MISSING_COLUMN] },
      },
    ]);
  });

  it("passes an entity whose results are all warnings", () => {
    expect(brokenRefChecks(reportOf("passed", [ANALYSIS_FAILED]), 42)).toEqual([
      {
        check: { kind: "broken-refs", id: CARD_ID, label: 'card "Revenue by day"' },
        verdict: "passed",
        warnings: [
          { code: "validation-exception-error", message: "The analysis failed: timed out" },
        ],
        ms: 0,
        detail: { entity: CARD, errors: [] },
      },
    ]);
  });
});

const TOO_OLD = new CapabilityError({
  reason: "version-too-old",
  detail: "the lint report",
  feature: "lintReport",
  since: 66,
  tokenFeature: "dependencies",
  serverVersion: "v1.65.0",
});

const FORBIDDEN = new HttpError({
  status: 403,
  statusText: "Forbidden",
  method: "POST",
  url: "https://m.example.com/api/ee/lint",
  responseHeaders: { "content-type": "application/json" },
  rawBody: "You don't have permissions to do that.",
});

describe("reportStop", () => {
  it("stops on a server that has no lint report, with the client's explanation", () => {
    expect(reportStop(TOO_OLD)).toEqual({
      code: "ci.unsupported-server",
      message: TOO_OLD.message,
    });
  });

  it("stops when there is no credential", () => {
    expect(reportStop(new NotAuthenticatedError("Not authenticated"))).toEqual({
      code: "ci.no-credential",
      message: "no Metabase credential, so the saved queries were not checked: Not authenticated",
    });
  });

  it("stops when the identity is not an admin", () => {
    expect(reportStop(FORBIDDEN)).toEqual({
      code: "ci.lint-forbidden",
      message: "only an admin can read the instance's lint report, and the CI identity is not one",
    });
  });

  it("stops on a request that failed", () => {
    const timeout = new TimeoutError("Request timed out after 600000ms", {
      kind: "http",
      method: "POST",
      url: "https://m.example.com/api/ee/lint",
      timeoutMs: 600_000,
    });

    expect(reportStop(timeout)).toEqual({ code: "ci.timeout", message: timeout.message });
  });

  it("answers null for a bug, which the stage rethrows", () => {
    expect(reportStop(new InternalError("bug"))).toBeNull();
  });
});
