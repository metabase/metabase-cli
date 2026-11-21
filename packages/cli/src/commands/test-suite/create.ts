import { TestSuite, TestSuiteCreateInput } from "@metabase/client/domain/test-suite";

import { renderSummary } from "../../output/render";
import { testSuiteView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { printable } from "../../output/table";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a test suite from JSON" },
  details:
    'The JSON body needs a `name` and the `members` the suite runs, in order. Each member is a `test_type` (`transform`, `card` or `segment`) and exactly one of `test_id` or `test_entity_id`, such as `{ "test_type": "card", "test_id": 34 }`; a test can be in a suite at most once, and the caller must be able to read it. `description` is optional. The body is closed at every level. On an instance where remote sync keeps synced content read-only, the server refuses every suite write with a plain 400 that carries no error code.',
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
    'mb test-suite create --body \'{"name":"nightly","members":[{"test_type":"card","test_id":34}]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.testSuite.create(body, { signal: interruptSignal });
    renderSummary(
      created,
      testSuiteView,
      `Created test suite ${created.id} "${printable(created.name)}".`,
      ctx,
    );
  },
});
