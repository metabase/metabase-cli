import { TestSuite, TestSuiteUpdateInput } from "@metabase/client/domain/test-suite";

import { renderSummary } from "../../output/render";
import { testSuiteView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a test suite from JSON" },
  details:
    "Only the fields the body carries are patched; `tests` replaces the suite's members rather than merging into them. The body is closed at every level.",
  requires: ["testSuite.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "string", description: "Test suite id", required: true },
  },
  inputSchema: TestSuiteUpdateInput,
  outputSchema: TestSuite,
  examples: [
    "mb test-suite update --id 5 --file suite.json",
    'mb test-suite update --id 5 --body \'{"name":"renamed"}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id, "--id");
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.testSuite.update(id, body, { signal: interruptSignal });
    renderSummary(updated, testSuiteView, `Updated test suite ${updated.id}.`, ctx);
  },
});
