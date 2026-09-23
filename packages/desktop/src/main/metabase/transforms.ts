import { z } from "zod";

import { TransformRun, TransformRunResult } from "@metabase/client/domain/transform";
import {
  TransformTestCompact,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";

import type {
  TransformRunOutcome,
  TransformRunSummary,
  TransformTestResult,
  TransformTestsOutcome,
} from "../../contracts/metabase";
import type { MetabaseCli } from "../cli/runner";

const PASSED = "passed";

const TransformWithLastRun = z
  .object({
    id: z.number().int(),
    last_run: TransformRun.pick({ status: true, start_time: true, end_time: true, message: true })
      .nullable()
      .optional(),
  })
  .loose();

const TransformTestList = z.object({ data: z.array(TransformTestCompact) }).loose();

type RunTimes = Pick<TransformRun, "status" | "start_time" | "end_time" | "message">;

function summaryOf(run: RunTimes): TransformRunSummary {
  const message = run.message === null || run.message.length === 0 ? null : run.message;
  return { status: run.status, at: run.end_time ?? run.start_time, message };
}

// A transform whose last run cannot be read still lists; the row then shows no last run.
export async function lastRunOf(
  cli: MetabaseCli,
  cwd: string,
  transformId: number,
): Promise<TransformRunSummary | null> {
  const read = await cli.run(
    cwd,
    ["transform", "get", String(transformId), "--full", "--max-bytes", "0"],
    TransformWithLastRun,
  );
  if (read.kind === "failed") {
    return null;
  }
  const lastRun = read.value.last_run ?? null;
  return lastRun === null ? null : summaryOf(lastRun);
}

export async function runTransform(
  cli: MetabaseCli,
  cwd: string,
  transformId: number,
): Promise<TransformRunOutcome> {
  const ran = await cli.report(
    cwd,
    ["transform", "run", String(transformId), "--wait"],
    TransformRunResult,
  );
  if (ran.kind === "failed") {
    return { kind: "refused", message: ran.message };
  }
  const final = ran.value.final;
  if (final === null) {
    return { kind: "refused", message: ran.value.message };
  }
  return { kind: "ran", run: summaryOf(final) };
}

function testResult(name: string, result: TransformTestRunResult): TransformTestResult {
  const failing = result.expectations
    .filter((expectation) => expectation.status !== PASSED)
    .map((expectation) => expectation.name);
  return { name, status: result.status, failing };
}

// Tests run one after another, because each fills its own scratch schema from the same warehouse.
export async function runTransformTests(
  cli: MetabaseCli,
  cwd: string,
  transformId: number,
): Promise<TransformTestsOutcome> {
  const listed = await cli.run(
    cwd,
    ["transform-test", "list", "--transform-id", String(transformId)],
    TransformTestList,
  );
  if (listed.kind === "failed") {
    return { kind: "refused", message: listed.message };
  }
  const tests: TransformTestResult[] = [];
  for (const test of listed.value.data) {
    const ran = await cli.run(
      cwd,
      ["transform-test", "run", String(test.id)],
      TransformTestRunResult,
    );
    if (ran.kind === "failed") {
      return { kind: "refused", message: `${test.name}: ${ran.message}` };
    }
    tests.push(testResult(test.name, ran.value));
  }
  return { kind: "ran", tests };
}
