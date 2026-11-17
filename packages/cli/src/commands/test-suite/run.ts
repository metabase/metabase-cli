import { TestSuiteRun } from "@metabase/client/domain/test-suite";

import { pluralize } from "../../output/pluralize";
import { renderVerdict, type VerdictFailure } from "../../output/render";
import { testSuiteRunView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag, requestTimeoutFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run every test in a test suite" },
  details:
    "Runs each test in the suite as its own test runs, in one synchronous request, so --timeout bounds the whole of it. --json reports each test's result. A suite with a test that does not pass exits 1, also when its report is over --max-bytes and is not printed.",
  requires: ["testSuite.run"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...requestTimeoutFlag,
    id: { type: "string", description: "Test suite id", required: true },
  },
  outputSchema: TestSuiteRun,
  examples: ["mb test-suite run --id 5", "mb test-suite run --id 5 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "--id");
    const timeoutMs = parseId(args.timeout, "timeout");
    const client = await getClient();
    const result = await client.testSuite.run(id, { timeoutMs, signal: interruptSignal });
    const tests = pluralize(result.results.length, "test", "tests");
    const failed = result.results.filter((entry) => entry.result.status !== "passed").length;
    const summary =
      failed === 0
        ? `Test suite ${id} passed ${tests}.`
        : `Test suite ${id} did not pass ${failed} of ${tests}.`;
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? `test suite ${id} failed` : `${summary} Its ${oversize}`;
    renderVerdict(
      {
        item: result,
        view: testSuiteRunView,
        summaryText: summary,
        failure: failed === 0 ? null : failure,
      },
      ctx,
    );
  },
});
