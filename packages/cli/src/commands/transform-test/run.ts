import {
  TransformTestAdhocRunInput,
  type TransformTestExpectationResult,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";
import { ConfigError, FailedResultError } from "@metabase/client/errors";
import { DEFAULT_TIMEOUT_MS } from "@metabase/client/http/transport";

import type { CommonContext } from "../context";

import { renderSummaryWithinMaxBytes } from "../../output/render";
import { transformTestRunResultView } from "../../output/views/transform-test";
import { givenValue } from "../../runtime/input";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { skipValidateFlag, TRANSFORM_TEST_ADHOC_SOURCE_QUERY } from "../validate-query";

type ExpectationStatus = TransformTestExpectationResult["status"];

function namesOf(
  expectations: TransformTestExpectationResult[],
  status: ExpectationStatus,
): string[] {
  return expectations.filter((expectation) => expectation.status === status).map((e) => e.name);
}

function summaryLine(label: string, result: TransformTestRunResult): string {
  if (result.status === "passed") {
    return `Transform test ${label} passed ${result.expectations.length} expectation(s).`;
  }
  const failed = namesOf(result.expectations, "failed");
  const errored = namesOf(result.expectations, "error");
  const parts = [
    failed.length > 0 ? `failed: ${failed.join(", ")}` : null,
    errored.length > 0 ? `could not run: ${errored.join(", ")}` : null,
  ].filter((part) => part !== null);
  return `Transform test ${label} ${result.status} — ${parts.join("; ")}.`;
}

function reportRun(label: string, result: TransformTestRunResult, ctx: CommonContext): void {
  const summary = summaryLine(label, result);
  const oversize = renderSummaryWithinMaxBytes(result, transformTestRunResultView, summary, ctx);
  if (result.status === "passed") {
    if (oversize !== null) {
      throw new ConfigError(oversize);
    }
    return;
  }
  // The run has already happened, so a report too big to print still owes the caller its outcome.
  const failure =
    oversize === null ? `transform test ${label} ${result.status}` : `${summary} Its ${oversize}`;
  throw new FailedResultError(failure);
}

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Run a transform test by id, or an unsaved test against an unsaved transform",
  },
  details:
    "Runs the transform against temp tables built from the test's inputs, checks every expectation against its output, and drops the temp tables. The transform and the expectations read only those temp tables; a `format: \"sql\"` input runs verbatim against the transform's source database. Without an id, the JSON body is `{transform, test}`: `transform` takes the `name`, `description`, `source` and `target` of a `mb transform create` body, and `test` a `mb transform-test create` body without `transform_id`. Neither is saved, and the run needs transforms permission and native query access on the transform's source database. When `transform.source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass. The run is one synchronous request, so --timeout bounds the whole of it. --json reports what each expectation found, including the rows a comparison disagreed on. A test that does not pass exits 1, also when its report is over --max-bytes and is not printed; the error then names the expectations that did not pass.",
  requires: ["transformTest.run", "transformTest.runAdhoc"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    timeout: {
      type: "string",
      description: "Request timeout in ms",
      default: String(DEFAULT_TIMEOUT_MS),
    },
    id: {
      type: "positional",
      description: "Transform test id; omit it to run the body instead",
      required: false,
    },
  },
  inputSchema: TransformTestAdhocRunInput,
  embeddedDocuments: [TRANSFORM_TEST_ADHOC_SOURCE_QUERY],
  outputSchema: TransformTestRunResult,
  examples: [
    "mb transform-test run 1",
    "mb transform-test run 1 --json",
    "mb transform-test run 1 --timeout 300000",
    "mb transform-test run --file adhoc-run.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const rawId = givenValue(args.id);
    const id = rawId === null ? null : parseId(rawId);
    const options = { timeoutMs: parseId(args.timeout, "timeout"), signal: interruptSignal };
    if (id !== null) {
      if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
        throw new ConfigError("an id cannot be combined with --body or --file");
      }
      const client = await getClient();
      reportRun(String(id), await client.transformTest.run(id, options), ctx);
      return;
    }
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    reportRun(`"${body.test.name}"`, await client.transformTest.runAdhoc(body, options), ctx);
  },
});
