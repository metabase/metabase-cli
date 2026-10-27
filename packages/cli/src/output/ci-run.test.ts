import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  TransformTestRow,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";
import { parseJson } from "@metabase/client/json";

import { type CiEventBody, CiEvent, createEmitter } from "../core/ci-events";
import { DEFAULT_MAX_ROWS } from "../core/ci-row-cap";
import { ciEventLines } from "./ci-run";

// The events of a real failing `mb ci run` in GitHub Actions: a transform's change broke one
// expectation of its test.
const RED_RUN_PATH = join(dirname(fileURLToPath(import.meta.url)), "ci-run.red-run.ndjson");

const BASE = "0c9c8393f4f88f11d1e035fe05c90e3a70c21cfd";
const HEAD = "eff94588cbd7431f1f751ce92ed2c9c70bd3957b";

function render(bodies: readonly CiEventBody[], maxRows: number): string[] {
  const lines: string[] = [];
  const emit = createEmitter({
    job: "job-1",
    now: () => new Date("2026-10-27T12:00:00.000Z"),
    write: (event) => lines.push(...ciEventLines(event, maxRows)),
  });
  for (const body of bodies) {
    emit(body);
  }
  return lines;
}

function jobStart(checked: number): CiEventBody {
  return {
    type: "job.start",
    v: 1,
    snapshot: { base: BASE, head: HEAD },
    checked: Array.from({ length: checked }, (_, index) => ({
      entity_id: `eid-${index}`,
      name: `transform_${index}`,
    })),
    warnings: [],
  };
}

const UNTOUCHED_PASSED: CiEventBody = {
  type: "check.result",
  stage: "lint",
  check: {
    kind: "coverage",
    id: "untouched",
    label: "Transforms whose logic this change did not touch",
  },
  verdict: "passed",
  warnings: [],
  ms: 0,
  detail: { untested: [] },
};

function unitCheck(verdict: "passed" | "failed", detail: TransformTestRunResult): CiEventBody {
  return {
    type: "check.result",
    stage: "unit",
    check: { kind: "transform-test", id: "1", label: "orders: order rules" },
    verdict,
    warnings: [],
    ms: 250,
    detail,
  };
}

function equalsFailure(
  missing: TransformTestRow[],
  extra: TransformTestRow[],
  truncated: number,
): TransformTestRunResult {
  return {
    status: "failed",
    tables: {},
    expectations: [
      {
        name: "one row per order",
        type: "equals",
        status: "failed",
        columns: [
          { name: "id", database_type: "int8" },
          { name: "status", database_type: "text" },
        ],
        "row-counts": { actual: extra.length, expected: missing.length },
        "missing-rows": missing,
        "extra-rows": extra,
        "cell-mismatches": [],
        truncated,
      },
    ],
  };
}

describe("ciEventLines", () => {
  it("renders a real failing run, pairing each missing row with the extra row of its key", () => {
    const events = readFileSync(RED_RUN_PATH, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));

    expect(events.flatMap((event) => ciEventLines(event, DEFAULT_MAX_ROWS))).toEqual([
      "mb ci run  base 0c9c839  head eff9458  1 transform checked",
      "lint",
      "  ✓ Transforms whose logic this change did not touch",
      "      ⚠ 1 transform whose logic this change did not touch has no tests: cfg_shopify",
      "unit",
      "  ✗ mart_shopify_fct_order: mart_shopify_fct_order: order rules  14.9s",
      "      ✗ one row per real order with the decided rules  20 rows, expected 19",
      "          missing  order_id=3  financial_status=refunded  is_valid_order=false  net_revenue=0.00",
      "          extra    order_id=3  financial_status=paid  is_valid_order=true  net_revenue=100.00",
      "          missing  order_id=2  financial_status=paid",
      "          extra    order_id=2  financial_status=authorized",
      "          extra    order_id=11  order_date=2026-03-10  order_month=2026-03-01  is_complete_period=true  sales_channel=online_store  financial_status=paid  is_valid_order=true  net_revenue=100.00  shipping_price=0.00  country_code=US  is_guest_checkout=false  customer_email=a@b.com  has_discount=false",
      "      ✓ order_id is unique",
      "      ✓ invalid orders carry zero net revenue",
      "FAILED  fix the transform (exit 1)",
    ]);
  });

  it("renders a passing job as one line per check, without the passed test's expectations", () => {
    const passed: TransformTestRunResult = {
      status: "passed",
      tables: {},
      expectations: [{ name: "order_id is unique", type: "empty", status: "passed" }],
    };

    expect(
      render(
        [
          jobStart(2),
          { type: "stage.start", stage: "lint" },
          UNTOUCHED_PASSED,
          { type: "stage.end", stage: "lint", status: "passed", stopped: null },
          { type: "stage.start", stage: "unit" },
          unitCheck("passed", passed),
          { type: "stage.end", stage: "unit", status: "passed", stopped: null },
          { type: "job.end", state: "passed", counts: { checks: 2, warnings: 0 } },
        ],
        DEFAULT_MAX_ROWS,
      ),
    ).toEqual([
      "mb ci run  base 0c9c839  head eff9458  2 transforms checked",
      "lint",
      "  ✓ Transforms whose logic this change did not touch",
      "unit",
      "  ✓ orders: order rules  250ms",
      "PASSED (exit 0)",
    ]);
  });

  it("renders a refused test with Metabase's message and ends ERRORED", () => {
    expect(
      render(
        [
          { type: "stage.start", stage: "unit" },
          {
            type: "check.result",
            stage: "unit",
            check: { kind: "transform-test", id: "4", label: "orders: order rules" },
            verdict: "refused",
            warnings: [],
            ms: 1250,
            detail: {
              error_code: "transform-test.unknown-column",
              message: "input orders has no column named total",
            },
          },
          { type: "stage.end", stage: "unit", status: "errored", stopped: null },
          { type: "job.end", state: "errored", counts: { checks: 1, warnings: 0 } },
        ],
        DEFAULT_MAX_ROWS,
      ),
    ).toEqual([
      "unit",
      "  ! orders: order rules  refused  1.3s",
      "      input orders has no column named total",
      "ERRORED  fix the test or the setup (exit 1)",
    ]);
  });

  it("renders a test run's HTTP failure as an error with the status", () => {
    expect(
      render(
        [
          {
            type: "check.result",
            stage: "unit",
            check: { kind: "transform-test", id: "4", label: "orders: order rules" },
            verdict: "error",
            warnings: [],
            ms: 1250,
            detail: { error_code: "ci.http-error", status: 503, message: "Service Unavailable" },
          },
        ],
        DEFAULT_MAX_ROWS,
      ),
    ).toEqual(["  ! orders: order rules  error  1.3s", "      Service Unavailable (HTTP 503)"]);
  });

  it("renders a stage that stopped early with its reason, and ends ERRORED", () => {
    expect(
      render(
        [
          { type: "stage.start", stage: "unit" },
          {
            type: "stage.end",
            stage: "unit",
            status: "errored",
            stopped: { code: "ci.unauthorized", message: "Unauthenticated" },
          },
          { type: "job.end", state: "errored", counts: { checks: 0, warnings: 0 } },
        ],
        DEFAULT_MAX_ROWS,
      ),
    ).toEqual([
      "unit",
      "unit  stopped: Unauthenticated (ci.unauthorized)",
      "ERRORED  fix the test or the setup (exit 1)",
    ]);
  });

  it("renders an untested change as a failed coverage check, and the unit stage as skipped", () => {
    expect(
      render(
        [
          jobStart(1),
          { type: "stage.start", stage: "lint" },
          {
            type: "check.result",
            stage: "lint",
            check: { kind: "coverage", id: "eid-0", label: "transform_0" },
            verdict: "failed",
            warnings: [],
            ms: 0,
            detail: {
              change: "new",
              message: "transform_0 is new in this change and has no transform tests",
            },
          },
          UNTOUCHED_PASSED,
          { type: "stage.end", stage: "lint", status: "failed", stopped: null },
          { type: "stage.end", stage: "unit", status: "skipped", stopped: null },
          { type: "job.end", state: "failed", counts: { checks: 2, warnings: 0 } },
        ],
        DEFAULT_MAX_ROWS,
      ),
    ).toEqual([
      "mb ci run  base 0c9c839  head eff9458  1 transform checked",
      "lint",
      "  ✗ transform_0",
      "      transform_0 is new in this change and has no transform tests",
      "  ✓ Transforms whose logic this change did not touch",
      "unit  skipped",
      "FAILED  fix the transform (exit 1)",
    ]);
  });

  it("shows --max-rows row lines and counts the rest, including the rows Metabase left out", () => {
    const extra = Array.from({ length: 12 }, (_, index) => ({ id: index, status: "paid" }));

    expect(render([unitCheck("failed", equalsFailure([], extra, 5))], 3)).toEqual([
      "  ✗ orders: order rules  250ms",
      "      ✗ one row per order  12 rows, expected 0",
      ...Array.from({ length: 3 }, (_, index) => `          extra    id=${index}  status=paid`),
      "          +14 more",
    ]);
  });

  it("shows only the counts when --max-rows is 0", () => {
    const extra = [{ id: 1, status: "paid" }];

    expect(render([unitCheck("failed", equalsFailure([], extra, 0))], 0)).toEqual([
      "  ✗ orders: order rules  250ms",
      "      ✗ one row per order  1 row, expected 0",
      "          +1 more",
    ]);
  });

  it("renders a cell mismatch as the column with its expected and actual values", () => {
    const result: TransformTestRunResult = {
      status: "failed",
      tables: {},
      expectations: [
        {
          name: "revenue per order",
          type: "equals",
          status: "failed",
          columns: [{ name: "net_revenue", database_type: "numeric" }],
          "row-counts": { actual: 1, expected: 1 },
          "missing-rows": [],
          "extra-rows": [],
          "cell-mismatches": [{ column: "net_revenue", expected: "0.00", actual: null }],
          truncated: 0,
        },
      ],
    };

    expect(render([unitCheck("failed", result)], DEFAULT_MAX_ROWS)).toEqual([
      "  ✗ orders: order rules  250ms",
      "      ✗ revenue per order  1 row, expected 1",
      "          net_revenue: expected 0.00, got null",
    ]);
  });
});
