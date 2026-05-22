import { describe, expect, it } from "vitest";

import { CardQueryResult } from "../domain/card";

import { formatQueryResult } from "./query-result";

describe("formatQueryResult", () => {
  it("renders an ASCII table of the result rows followed by a row-count summary", () => {
    const result = CardQueryResult.parse({
      status: "completed",
      row_count: 5,
      data: {
        cols: [{ name: "status" }, { name: "n" }],
        rows: [
          ["pending", 2],
          ["paid", 3],
        ],
      },
    });
    expect(formatQueryResult(result)).toBe(
      `┌─────────┬───┐
│ status  │ n │
├─────────┼───┤
│ pending │ 2 │
├─────────┼───┤
│ paid    │ 3 │
└─────────┴───┘
5 rows.`,
    );
  });

  it("prefers a column's display_name over its raw name for the header", () => {
    const result = CardQueryResult.parse({
      status: "completed",
      data: { cols: [{ name: "n", display_name: "Order count" }], rows: [[2]] },
    });
    expect(formatQueryResult(result)).toBe(
      `┌─────────────┐
│ Order count │
├─────────────┤
│ 2           │
└─────────────┘
1 row.`,
    );
  });

  it("falls back to the row array length when row_count is absent and pluralizes correctly", () => {
    const result = CardQueryResult.parse({
      status: "completed",
      data: { cols: [{ name: "n" }], rows: [[1], [2]] },
    });
    expect(formatQueryResult(result)).toBe(
      `┌───┐
│ n │
├───┤
│ 1 │
├───┤
│ 2 │
└───┘
2 rows.`,
    );
  });

  it("renders only the summary (no table) when there are zero rows", () => {
    const result = CardQueryResult.parse({
      status: "completed",
      row_count: 0,
      data: { cols: [{ name: "n" }], rows: [] },
    });
    expect(formatQueryResult(result)).toBe("0 rows.");
  });

  it("reports the error message when the query did not complete", () => {
    const result = CardQueryResult.parse({ status: "failed", error: "division by zero" });
    expect(formatQueryResult(result)).toBe("Query failed: division by zero");
  });

  it("reports the bare status when a non-completed result carries no error", () => {
    const result = CardQueryResult.parse({ status: "running" });
    expect(formatQueryResult(result)).toBe("Query running");
  });
});
