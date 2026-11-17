import { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import { renderVerdict, type VerdictFailure } from "../../output/render";
import { testRunSummary } from "../../output/test-run";
import { transformTestRunResultView } from "../../output/views/transform-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag, requestTimeoutFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run a transform test by id" },
  details:
    "Runs the transform against temp tables built from the test's inputs, checks every expectation against its output, and drops the temp tables. The transform and the expectations read only those temp tables; a `format: \"sql\"` input runs verbatim against the transform's source database. The run is one synchronous request, so --timeout bounds the whole of it. --json reports what each expectation found, including the rows a comparison disagreed on. A test that does not pass exits 1, also when its report is over --max-bytes and is not printed; the error then names the expectations that did not pass.",
  requires: ["transformTest.run"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...requestTimeoutFlag,
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
    const summary = testRunSummary(`Transform test ${id}`, result);
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? `transform test ${id} ${result.status}` : `${summary} Its ${oversize}`;
    renderVerdict(
      {
        item: result,
        view: transformTestRunResultView,
        summaryText: summary,
        failure: result.status === "passed" ? null : failure,
      },
      ctx,
    );
  },
});
