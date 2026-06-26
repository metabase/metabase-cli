import { z } from "zod";

import { ConfigError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { TestRunInput, TestRunResult, testRunResultView } from "../../domain/transform-test-run";
import { renderSummary } from "../../output/render";
import { readFilePart } from "../../runtime/upload";
import type { CommonContext } from "../context";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";

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
  return `/api/transform-test/${targetType}/${target}/subgraph-inputs`;
}

function subgraphPath(targetType: TargetType, target: number): string {
  return `/api/transform-test/${targetType}/${target}/subgraph`;
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
  expected: string;
  ignoreColumns: string[];
}

async function buildSubgraphForm(args: SubgraphRunArgs): Promise<FormData> {
  const form = new FormData();
  for (const { tableId, path } of args.inputs) {
    const part = await readFilePart(path, `--input ${tableId}`);
    form.append(`input-${tableId}`, part.blob, part.filename);
  }
  const expectedPart = await readFilePart(args.expected, "--expected");
  form.append("expected", expectedPart.blob, expectedPart.filename);
  if (args.sources.length > 0) {
    form.append("sources", JSON.stringify(args.sources));
  }
  if (args.ignoreColumns.length > 0) {
    form.append("options", JSON.stringify({ ignore_columns: args.ignoreColumns }));
  }
  return form;
}

function summaryLine(targetType: TargetType, target: number, result: TestRunResult): string {
  const noun = targetLabels(targetType).summaryNoun;
  if (result.status === "passed") {
    return `${noun} ${target} test run passed.`;
  }
  return `${noun} ${target} test run FAILED — output did not match expected. Re-run with --json to see the diff.`;
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

  renderSummary(
    result,
    testRunResultView,
    () => summaryLine(args.targetType, args.target, result),
    ctx,
  );

  if (result.status === "failed") {
    const noun = targetLabels(args.targetType).summaryNoun.toLowerCase();
    throw new Error(`${noun} ${args.target} test run failed: output did not match expected`);
  }
}
