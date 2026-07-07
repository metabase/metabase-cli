import { z } from "zod";

import { ConfigError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import {
  type AssertionResult,
  assertionResultView,
  TestRunInput,
  TestRunResult,
  testRunResultView,
} from "../../domain/transform-test-run";
import { renderList, renderSummary, writeText } from "../../output/render";
import { wrapList } from "../../output/types";
import { readFilePart } from "../../runtime/upload";
import type { CommonContext } from "../context";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";

import type { AssertionDef } from "./assert";

export const TargetType = z.enum(["transform", "card"]);
export type TargetType = z.infer<typeof TargetType>;

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
  return parseEnumFlag(value, TargetType, "--target-type");
}

export const targetTypeFlag = {
  "target-type": {
    type: "string",
    description: `Test-run target kind: ${TargetType.options.join(" | ")} (default: ${DEFAULT_TARGET_TYPE})`,
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

function subgraphInputsPath(targetType: TargetType, target: number): string {
  return `/api/ee/transform-test/${targetType}/${target}/inputs`;
}

function subgraphPath(targetType: TargetType, target: number): string {
  return `/api/ee/transform-test/${targetType}/${target}/run`;
}

export async function fetchSubgraphInputs(
  client: Client,
  targetType: TargetType,
  target: number,
  sources: number[],
): Promise<TestRunInput[]> {
  return client.requestParsed(z.array(TestRunInput), subgraphInputsPath(targetType, target), {
    query: { sources },
  });
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

export async function buildSubgraphForm(args: SubgraphRunArgs): Promise<FormData> {
  const form = new FormData();
  for (const { tableId, path } of args.inputs) {
    const part = await readFilePart(path, `--input ${tableId}`);
    form.append(`input-${tableId}`, part.blob, part.filename);
  }
  if (args.expected !== undefined) {
    const expectedPart = await readFilePart(args.expected, "--expected");
    form.append("expected", expectedPart.blob, expectedPart.filename);
  }
  if (args.sources.length > 0) {
    form.append("sources", JSON.stringify(args.sources));
  }
  if (args.ignoreColumns.length > 0) {
    form.append("options", JSON.stringify({ ignore_columns: args.ignoreColumns }));
  }
  if (args.assertions.length > 0) {
    form.append("assertions", JSON.stringify(args.assertions));
  }
  return form;
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
    renderList(wrapList(assertions), assertionResultView, ctx);
  }
}

export async function runSubgraph(
  client: Client,
  args: SubgraphRunArgs,
  ctx: CommonContext,
): Promise<void> {
  const form = await buildSubgraphForm(args);
  const result = await client.requestParsed(
    TestRunResult,
    subgraphPath(args.targetType, args.target),
    {
      method: "POST",
      body: form,
    },
  );

  renderRunResult(args.targetType, args.target, result, ctx);

  if (shouldFail(result)) {
    const noun = targetLabels(args.targetType).summaryNoun.toLowerCase();
    throw new Error(`${noun} ${args.target} test run failed`);
  }
}
