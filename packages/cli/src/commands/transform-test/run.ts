import {
  type TransformTestExpectationResult,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";
import { ConfigError, FailedResultError } from "@metabase/client/errors";
import { DEFAULT_TIMEOUT_MS } from "@metabase/client/http/transport";

import { renderSummaryWithinMaxBytes } from "../../output/render";
import { transformTestRunResultView } from "../../output/views/transform-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

type ExpectationStatus = TransformTestExpectationResult["status"];

function namesOf(
  expectations: TransformTestExpectationResult[],
  status: ExpectationStatus,
): string[] {
  return expectations.filter((expectation) => expectation.status === status).map((e) => e.name);
}

function summaryLine(id: number, result: TransformTestRunResult): string {
  if (result.status === "passed") {
    return `Transform test ${id} passed ${result.expectations.length} expectation(s).`;
  }
  const failed = namesOf(result.expectations, "failed");
  const errored = namesOf(result.expectations, "error");
  const parts = [
    failed.length > 0 ? `failed: ${failed.join(", ")}` : null,
    errored.length > 0 ? `could not run: ${errored.join(", ")}` : null,
  ].filter((part) => part !== null);
  return `Transform test ${id} ${result.status} — ${parts.join("; ")}.`;
}

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run a transform test by id" },
  details:
    "Builds temp tables from the test's inputs, runs the transform against them, checks every expectation against its output, and drops the temp tables. A `format: \"sql\"` input runs verbatim against the transform's source database. The run is one synchronous request, so `--timeout` bounds all of it; `--json` reports what each expectation found, including the rows a comparison disagreed on. A test that doesn't pass exits 1, even when its report is over `--max-bytes` and isn't printed, and the error names the expectations that failed.",
  requires: ["transformTest.run"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    timeout: {
      type: "string",
      description: "Request timeout in ms",
      default: String(DEFAULT_TIMEOUT_MS),
    },
    id: { type: "positional", description: "Transform test id", required: true },
  },
  outputSchema: TransformTestRunResult,
  examples: [
    "mb transform-test run 1",
    "mb transform-test run 1 --json",
    "mb transform-test run 1 --timeout 300000",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const timeoutMs = parseId(args.timeout, "timeout");
    const client = await getClient();
    const result = await client.transformTest.run(id, { timeoutMs, signal: interruptSignal });
    const summary = summaryLine(id, result);
    const oversize = renderSummaryWithinMaxBytes(result, transformTestRunResultView, summary, ctx);
    if (result.status === "passed") {
      if (oversize !== null) {
        throw new ConfigError(oversize);
      }
      return;
    }
    // The run has already happened, so a report too big to print still owes the caller its outcome.
    const failure =
      oversize === null ? `transform test ${id} ${result.status}` : `${summary} Its ${oversize}`;
    throw new FailedResultError(failure);
  },
});
