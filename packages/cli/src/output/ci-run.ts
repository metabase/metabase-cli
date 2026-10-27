import { z } from "zod";

import {
  type TransformTestExpectationResult,
  type TransformTestResultColumn,
  type TransformTestRow,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";
import { InternalError } from "@metabase/client/errors";

import type { CiEvent, JobState, Verdict } from "../core/ci-events";
import { exitCodeFor } from "./error";

type CheckResult = Extract<CiEvent, { type: "check.result" }>;
type StageEnd = Extract<CiEvent, { type: "stage.end" }>;
type Cell = TransformTestRow[string];

// Each row line costs a reader a line of the job log; the rest are in the --results file.
const MAX_ROW_LINES = 10;
const SHORT_SHA_LENGTH = 7;
const MS_PER_SECOND = 1000;
const PASSED_EXIT_CODE = 0;

const CHECK_INDENT = "  ";
const DETAIL_INDENT = "      ";
const ROW_INDENT = "          ";

const VERDICT_MARK: Readonly<Record<Verdict, string>> = {
  passed: "✓",
  failed: "✗",
  error: "!",
  refused: "!",
};

const JOB_END_TEXT: Readonly<Record<JobState, string>> = {
  passed: "PASSED",
  failed: "FAILED  fix the transform",
  errored: "ERRORED  fix the test or the setup",
};

// A refused transform test and a failed coverage check carry a message as their detail; a request
// that failed with an HTTP answer also carries its status.
const CheckMessage = z.object({ message: z.string() });
const HttpFailureMessage = CheckMessage.extend({ status: z.number().int() });

// The text form of one CI event: a line or more, or none for an event the next one makes plain.
export function ciEventLines(event: CiEvent): string[] {
  switch (event.type) {
    case "job.start": {
      const count = event.checked.length;
      const noun = count === 1 ? "transform" : "transforms";
      const head = `mb ci run  base ${shortSha(event.snapshot.base)}  head ${shortSha(event.snapshot.head)}  ${count} ${noun} checked`;
      return [head, ...event.warnings.map((warning) => `⚠ ${warning.message}`)];
    }
    case "stage.start": {
      return [event.stage];
    }
    case "check.result": {
      return checkLines(event);
    }
    case "stage.end": {
      return stageEndLines(event);
    }
    case "job.end": {
      return [`${JOB_END_TEXT[event.state]} (exit ${jobExitCode(event.state)})`];
    }
  }
}

function stageEndLines(event: StageEnd): string[] {
  if (event.stopped !== null) {
    return [`${event.stage}  stopped: ${event.stopped.message} (${event.stopped.code})`];
  }
  return event.status === "skipped" ? [`${event.stage}  skipped`] : [];
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function jobExitCode(state: JobState): number {
  return state === "passed" ? PASSED_EXIT_CODE : exitCodeFor("failed");
}

function checkLines(event: CheckResult): string[] {
  const parts = [`${CHECK_INDENT}${VERDICT_MARK[event.verdict]} ${event.check.label}`];
  if (event.verdict === "error" || event.verdict === "refused") {
    parts.push(event.verdict);
  }
  if (event.ms > 0) {
    parts.push(duration(event.ms));
  }
  const warnings = event.warnings.map((warning) => `${DETAIL_INDENT}⚠ ${warning.message}`);
  const detail = event.verdict === "passed" ? [] : detailLines(event);
  return [parts.join("  "), ...warnings, ...detail];
}

function duration(ms: number): string {
  if (ms < MS_PER_SECOND) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
}

// A transform test's result, or else a message. The runner wrote the detail, so one that is
// neither is a bug in the runner.
function detailLines(event: CheckResult): string[] {
  const result = TransformTestRunResult.safeParse(event.detail);
  if (result.success) {
    return result.data.expectations.flatMap(expectationLines);
  }
  const httpFailure = HttpFailureMessage.safeParse(event.detail);
  if (httpFailure.success) {
    return [`${DETAIL_INDENT}${httpFailure.data.message} (HTTP ${httpFailure.data.status})`];
  }
  const message = CheckMessage.safeParse(event.detail);
  if (!message.success) {
    throw new InternalError(
      `ci check "${event.check.label}" has a detail of no known shape: ${message.error.message}`,
    );
  }
  return [`${DETAIL_INDENT}${message.data.message}`];
}

function expectationLines(result: TransformTestExpectationResult): string[] {
  const line = `${DETAIL_INDENT}${VERDICT_MARK[result.status]} ${result.name}`;
  if (result.status === "passed") {
    return [line];
  }
  if (result.status === "error") {
    return [`${line}  error: ${result.error.message}`];
  }
  if (result.type === "empty") {
    const rows = result.sample.length + result.truncated;
    const sample = result.sample.map(
      (row) => `row  ${cellsText(row, columnNames(result.columns))}`,
    );
    return [
      `${line}  ${rows} ${rowNoun(rows)}, expected none`,
      ...capped(sample, result.truncated),
    ];
  }
  const counts = result["row-counts"];
  const rowLines = rowDiffLines(
    result["missing-rows"],
    result["extra-rows"],
    columnNames(result.columns),
  );
  const mismatches = result["cell-mismatches"].map(
    (mismatch) =>
      `${mismatch.column}: expected ${cellText(mismatch.expected)}, got ${cellText(mismatch.actual)}`,
  );
  return [
    `${line}  ${counts.actual} ${rowNoun(counts.actual)}, expected ${counts.expected}`,
    ...capped([...rowLines, ...mismatches], result.truncated),
  ];
}

function rowNoun(count: number): string {
  return count === 1 ? "row" : "rows";
}

function columnNames(columns: readonly TransformTestResultColumn[]): string[] {
  return columns.map((column) => column.name);
}

function capped(lines: readonly string[], truncated: number): string[] {
  const shown = lines.slice(0, MAX_ROW_LINES).map((line) => `${ROW_INDENT}${line}`);
  const hidden = Math.max(lines.length - MAX_ROW_LINES, 0) + truncated;
  if (hidden === 0) {
    return shown;
  }
  return [...shown, `${ROW_INDENT}+${hidden} more`];
}

// Rows are keyed by the first column. A missing row and an extra row with the same key are the
// same row, wrong; for those only the columns that differ are shown, so the wrong value stands out.
function rowDiffLines(
  missing: readonly TransformTestRow[],
  extra: readonly TransformTestRow[],
  columns: readonly string[],
): string[] {
  const [key, ...rest] = columns;
  if (key === undefined) {
    return [
      ...missing.map((row) => `missing  ${cellsText(row, Object.keys(row))}`),
      ...extra.map((row) => `extra    ${cellsText(row, Object.keys(row))}`),
    ];
  }
  const unpaired = [...extra];
  const lines: string[] = [];
  for (const row of missing) {
    const index = unpaired.findIndex((candidate) => candidate[key] === row[key]);
    const partner = unpaired[index];
    if (partner === undefined) {
      lines.push(`missing  ${cellsText(row, columns)}`);
      continue;
    }
    unpaired.splice(index, 1);
    const differing = rest.filter((column) => row[column] !== partner[column]);
    lines.push(`missing  ${cellsText(row, [key, ...differing])}`);
    lines.push(`extra    ${cellsText(partner, [key, ...differing])}`);
  }
  for (const row of unpaired) {
    lines.push(`extra    ${cellsText(row, columns)}`);
  }
  return lines;
}

function cellsText(row: TransformTestRow, columns: readonly string[]): string {
  return columns.map((column) => `${column}=${cellText(row[column])}`).join("  ");
}

function cellText(value: Cell | undefined): string {
  if (value === undefined) {
    return "(absent)";
  }
  return value === null ? "null" : String(value);
}
