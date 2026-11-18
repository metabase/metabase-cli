import { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { ConfigError, FailedResultError } from "@metabase/client/errors";
import { DEFAULT_TIMEOUT_MS } from "@metabase/client/http/transport";

import { renderSummaryWithinMaxBytes } from "../../output/render";
import { testRunSummary } from "../../output/test-run";
import { segmentTestRunResultView } from "../../output/views/segment-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run a segment test by id" },
  details:
    "Selects the rows that match the segment's filter from temp tables built from the test's inputs, checks every expectation against those rows, and drops the temp tables. The segment's query and the expectations read only those temp tables; a `format: \"sql\"` input runs verbatim against the segment's database. The run is one synchronous request, so --timeout bounds the whole of it. --json reports what each expectation found, including the rows a comparison disagreed on. A test that does not pass exits 1, also when its report is over --max-bytes and is not printed; the error then names the expectations that did not pass. A run the server refuses fails with an `error_code` that starts with `segment-test.`.",
  requires: ["segmentTest.run"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    timeout: {
      type: "string",
      description: "Request timeout in ms",
      default: String(DEFAULT_TIMEOUT_MS),
    },
    id: { type: "positional", description: "Segment test id", required: true },
  },
  outputSchema: TransformTestRunResult,
  examples: [
    "mb segment-test run 1",
    "mb segment-test run 1 --json",
    "mb segment-test run 1 --timeout 300000",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const timeoutMs = parseId(args.timeout, "timeout");
    const client = await getClient();
    const result = await client.segmentTest.run(id, { timeoutMs, signal: interruptSignal });
    const summary = testRunSummary(`Segment test ${id}`, result);
    const oversize = renderSummaryWithinMaxBytes(result, segmentTestRunResultView, summary, ctx);
    if (result.status === "passed") {
      if (oversize !== null) {
        throw new ConfigError(oversize);
      }
      return;
    }
    const failure =
      oversize === null ? `segment test ${id} ${result.status}` : `${summary} Its ${oversize}`;
    throw new FailedResultError(failure);
  },
});
