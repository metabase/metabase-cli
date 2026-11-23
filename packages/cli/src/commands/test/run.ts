import { DataTestRunResult } from "@metabase/client/domain/data-test";

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
    "The run is one synchronous request, so --timeout bounds the whole of it. A test that does not pass exits 1.",
  requires: ["dataTest.run"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...requestTimeoutFlag,
    id: { type: "string", description: "The test, such as card-test:34", required: true },
  },
  outputSchema: DataTestRunResult,
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
    const result = await client.dataTest.run(ref.type, ref.id, options);
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
