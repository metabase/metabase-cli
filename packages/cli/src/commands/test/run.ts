import { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import { renderVerdict, type VerdictFailure } from "../../output/render";
import { testRunSummary } from "../../output/test-run";
import { transformTestRunResultView } from "../../output/views/transform-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag, requestTimeoutFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseTestRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run a data test" },
  details:
    "--id names the test as `<type>-test:<id>` (`card-test:34`). Runs the test's entity against temp tables built from its inputs, checks every expectation against the output, and drops the temp tables. The run is one synchronous request, so --timeout bounds the whole of it. --json reports what each expectation found. A test that does not pass exits 1, also when its report is over --max-bytes and is not printed.",
  requires: [
    "transformTest.run",
    "cardTest.run",
    "segmentTest.run",
    "measureTest.run",
    "actionTest.run",
  ],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...requestTimeoutFlag,
    id: { type: "string", description: "The test, such as card-test:34", required: true },
  },
  outputSchema: TransformTestRunResult,
  examples: [
    "mb test run --id card-test:34",
    "mb test run --id transform-test:7 --json",
    "mb test run --id card-test:34 --timeout 300000",
  ],
  async run({ args, ctx, getClient }) {
    const ref = parseTestRef(args.id);
    const text = testRefText(ref);
    const options = { timeoutMs: parseId(args.timeout, "timeout"), signal: interruptSignal };
    const client = await getClient();
    function runTest(): Promise<TransformTestRunResult> {
      switch (ref.type) {
        case "transform": {
          return client.transformTest.run(ref.id, options);
        }
        case "card": {
          return client.cardTest.run(ref.id, options);
        }
        case "segment": {
          return client.segmentTest.run(ref.id, options);
        }
        case "measure": {
          return client.measureTest.run(ref.id, options);
        }
        case "action": {
          return client.actionTest.run(ref.id, options);
        }
      }
    }
    const result = await runTest();
    const summary = testRunSummary(text, result);
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? `${text} ${result.status}` : `${summary} Its ${oversize}`;
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
