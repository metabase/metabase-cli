import { TestSuiteCompact } from "@metabase/client/domain/test-suite";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { testSuiteView } from "../../output/views/test-suite";
import { windowList } from "../../output/window";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TestSuiteListEnvelope = listEnvelopeSchema(TestSuiteCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List test suites" },
  details: "Suites are listed in name order.",
  requires: ["testSuite.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: TestSuiteListEnvelope,
  examples: ["mb test-suite list", "mb test-suite list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.testSuite.list({ signal: interruptSignal });
    renderList(windowList(data, ctx.range), testSuiteView, ctx);
  },
});
