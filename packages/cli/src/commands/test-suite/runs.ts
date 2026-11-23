import { TestSuiteRunRecordCompact } from "@metabase/client/domain/test-suite";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { testSuiteRunRecordView } from "../../output/views/test-suite";
import { collectForOutput } from "../../output/window";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TestSuiteRunListEnvelope = listEnvelopeSchema(TestSuiteRunRecordCompact);

export default defineMetabaseCommand({
  meta: { name: "runs", description: "List the runs of a test suite" },
  details:
    "Runs are listed newest first. Pass --full for each run's member outcomes: every member's `status` is shown, but never its test's id, name or result, and its `error` only when the test exists and you may run it. A run's `members` is null while it is started, and stays null when it ends in `error` or `timeout`.",
  requires: ["testSuite.runPages"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "string", description: "Test suite id", required: true },
  },
  outputSchema: TestSuiteRunListEnvelope,
  examples: [
    "mb test-suite runs --id 5",
    "mb test-suite runs --id 5 --limit 10 --json",
    "mb test-suite runs --id 5 --full --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "--id");
    const client = await getClient();
    const envelope = await collectForOutput(
      (request) => client.testSuite.runPages(id, { ...request, signal: interruptSignal }),
      testSuiteRunRecordView,
      ctx,
    );
    renderList(envelope, testSuiteRunRecordView, ctx);
  },
});
