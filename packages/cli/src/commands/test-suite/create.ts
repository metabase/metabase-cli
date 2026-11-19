import { TestSuite, TestSuiteCreateInput } from "@metabase/client/domain/test-suite";

import { renderSummary } from "../../output/render";
import { testSuiteView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a test suite from JSON" },
  details:
    'The JSON body needs a `name` and the `tests` the suite runs, each `{ "test_type": "card", "test_id": 34 }`; `description` is optional. The body is closed at every level.',
  requires: ["testSuite.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: TestSuiteCreateInput,
  outputSchema: TestSuite,
  examples: [
    "mb test-suite create --file suite.json",
    'mb test-suite create --body \'{"name":"nightly","tests":[{"test_type":"card","test_id":34}]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.testSuite.create(body, { signal: interruptSignal });
    renderSummary(
      created,
      testSuiteView,
      `Created test suite ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
