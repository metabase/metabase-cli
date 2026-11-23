import { TestSuiteRun } from "@metabase/client/domain/test-suite";

import { renderVerdict, type VerdictFailure } from "../../output/render";
import { testSuiteRunSummary, testSuiteRunView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag, requestTimeoutFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run every test in a test suite" },
  details:
    "Runs the suite's members in order, each as its own test run would run it, in one synchronous request that the server records as a run, so --timeout bounds the whole of it. Each member reports `passed`, `failed`, `refused` (its own run would have been refused), `error`, `forbidden` (you may not run it) or `missing` (the test, or what it tests, is gone). The suite passes only when every member passed; a suite that failed, or that the server timed out, exits 1, also when its report is over --max-bytes and is not printed. --json reports each member's outcome, with its test's result when it passed or failed.",
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
    const label = `Test suite ${id}`;
    const summary = testSuiteRunSummary(label, result);
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? `test suite ${id} ${result.status}` : `${summary}\nIts ${oversize}`;
    renderVerdict(
      {
        item: result,
        view: testSuiteRunView,
        summaryText: summary,
        failure: result.status === "passed" ? null : failure,
      },
      ctx,
    );
  },
});
