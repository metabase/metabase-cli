import type { MetabaseClient } from "@metabase/client/client";
import {
  type AssertionResult,
  type TestRunResult,
  TestRunTargetType,
} from "@metabase/client/domain/transform-test-run";
import { ConfigError } from "@metabase/client/errors";
import type { TestRunParams } from "@metabase/client/resources/transform-test";

import { renderList, renderSummary, writeText } from "../../output/render";
import { FULL_RANGE } from "../../output/types";
import { assertionResultView, testRunResultView } from "../../output/views/transform-test-run";
import { windowList } from "../../output/window";
import { readFixtureFile } from "../../runtime/upload";
import type { CommonContext } from "../context";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";

import type { AssertionDef } from "./assert";

export type TargetType = TestRunTargetType;

const DEFAULT_TARGET_TYPE: TargetType = "transform";

interface TargetLabels {
  positionalLabel: string;
  summaryNoun: string;
}

const TARGET_LABELS: Record<TargetType, TargetLabels> = {
  transform: { positionalLabel: "Target transform id", summaryNoun: "Transform" },
  card: { positionalLabel: "Target card id (saved question or model)", summaryNoun: "Card" },
};

export function targetLabels(targetType: TargetType): TargetLabels {
  return TARGET_LABELS[targetType];
}

export function parseTargetType(value: string): TargetType {
  return parseEnumFlag(value, TestRunTargetType, "--target-type");
}

export const targetTypeFlag = {
  "target-type": {
    type: "string",
    description: `Test-run target kind: ${TestRunTargetType.options.join(" | ")} (default: ${DEFAULT_TARGET_TYPE})`,
    default: DEFAULT_TARGET_TYPE,
  },
} as const;

export interface InputPair {
  tableId: number;
  path: string;
}

function parseInputPair(pair: string): InputPair {
  const eq = pair.indexOf("=");
  if (eq <= 0 || eq === pair.length - 1) {
    throw new ConfigError(
      `Malformed --input entry '${pair}'. Expected <table-id>=<file> (e.g. 229=orders.csv).`,
    );
  }
  const tableId = parseId(pair.slice(0, eq).trim(), "--input table id");
  return { tableId, path: pair.slice(eq + 1).trim() };
}

export function parseInputPairs(value: string | undefined): InputPair[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(parseInputPair);
}

export function parseColumnList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export interface SubgraphRunArgs {
  targetType: TargetType;
  target: number;
  sources: number[];
  inputs: InputPair[];
  // Optional per field; the run requires at least one of expected or assertions.
  expected?: string;
  ignoreColumns: string[];
  assertions: AssertionDef[];
}

export async function buildRunParams(args: SubgraphRunArgs): Promise<TestRunParams> {
  const inputs = await Promise.all(
    args.inputs.map(async ({ tableId, path }) => ({
      table_id: tableId,
      file: await readFixtureFile(path, `--input ${tableId}`),
    })),
  );
  const params: TestRunParams = {
    sources: args.sources,
    inputs,
    ignore_columns: args.ignoreColumns,
    assertions: args.assertions,
  };
  if (args.expected !== undefined) {
    params.expected = await readFixtureFile(args.expected, "--expected");
  }
  return params;
}

function assertionList(result: TestRunResult): AssertionResult[] {
  return result.assertions ?? [];
}

// Exit nonzero iff the server's top-level status is `failed`.
export function shouldFail(result: TestRunResult): boolean {
  return result.status === "failed";
}

export function assertionsSummaryLine(result: TestRunResult): string | null {
  const assertions = assertionList(result);
  if (assertions.length === 0) {
    return null;
  }
  const passed = assertions.filter((a) => a.status === "passed").length;
  const failed = assertions.filter((a) => a.status === "failed").length;
  const warned = assertions.filter((a) => a.status === "warn").length;
  const parts = [`${passed} passed`, `${failed} FAILED`, `${warned} warn`];
  const firstFailing = assertions.find((a) => a.status === "failed" || a.status === "warn");
  const detail =
    firstFailing === undefined
      ? ""
      : ` (${firstFailing.name}: ${firstFailing.failing_row_count} failing rows)`;
  return `${assertions.length} assertions — ${parts.join(", ")}${detail}`;
}

function summaryLine(targetType: TargetType, target: number, result: TestRunResult): string {
  const noun = targetLabels(targetType).summaryNoun;
  const lines: string[] = [];
  const diffShown = (result.diff ?? null) !== null;
  if (result.status === "passed") {
    lines.push(`${noun} ${target} test run passed.`);
  } else if (diffShown) {
    lines.push(
      `${noun} ${target} test run FAILED — output did not match expected. Re-run with --json to see the diff.`,
    );
  } else {
    lines.push(`${noun} ${target} test run FAILED. Re-run with --json to see details.`);
  }
  const assertions = assertionsSummaryLine(result);
  if (assertions !== null) {
    lines.push(assertions);
  }
  return lines.join("\n");
}

// Render a run result. Under `--json` (and `--fields`/`--full`) the full structured result is
// emitted; otherwise the human view: the summary line(s) followed — on any run that carried
// assertions, passing OR failing — by the per-assertion table (name / status / failing rows).
export function renderRunResult(
  targetType: TargetType,
  target: number,
  result: TestRunResult,
  ctx: CommonContext,
): void {
  renderSummary(result, testRunResultView, () => summaryLine(targetType, target, result), ctx);

  const humanView = ctx.format !== "json" && ctx.fields === undefined && !ctx.full;
  const assertions = assertionList(result);
  if (humanView && assertions.length > 0) {
    writeText("");
    renderList(windowList(assertions, FULL_RANGE), assertionResultView, ctx);
  }
}

export async function runSubgraph(
  client: MetabaseClient,
  args: SubgraphRunArgs,
  ctx: CommonContext,
): Promise<void> {
  const params = await buildRunParams(args);
  const result = await client.transformTest.run(args.targetType, args.target, params);

  renderRunResult(args.targetType, args.target, result, ctx);

  if (shouldFail(result)) {
    const noun = targetLabels(args.targetType).summaryNoun.toLowerCase();
    throw new Error(`${noun} ${args.target} test run failed`);
  }
}
