import { TestSuite } from "@metabase/client/domain/test-suite";

import { renderItem } from "../../output/render";
import { testSuiteView } from "../../output/views/test-suite";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a test suite by id" },
  details: "Pass --full for the `tests` the suite runs, each named by `test_type` and `test_id`.",
  requires: ["testSuite.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "string", description: "Test suite id", required: true },
  },
  outputSchema: TestSuite,
  examples: ["mb test-suite get --id 5", "mb test-suite get --id 5 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "--id");
    const client = await getClient();
    renderItem(await client.testSuite.get(id, { signal: interruptSignal }), testSuiteView, ctx);
  },
});
