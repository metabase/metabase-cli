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
    "Only the fields the body carries are patched; `members` replaces every member, in the order given, rather than merging into them. Each member is a `test_type` and exactly one of `test_id` or `test_entity_id`, naming a test the caller can read, except that a current member the caller cannot read, or whose test is missing, is kept when named by `test_type` and `test_entity_id`. The body is closed at every level. On an instance where remote sync keeps synced content read-only, the server refuses every suite write with a plain 400 that carries no error code.",
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
    'mb test-suite update --id 5 --body \'{"members":[{"test_type":"transform","test_entity_id":"x8Gq1V2nYk3bJ0p9aLrTe"}]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id, "--id");
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.testSuite.update(id, body, { signal: interruptSignal });
    renderSummary(updated, testSuiteView, `Updated test suite ${updated.id}.`, ctx);
  },
});
