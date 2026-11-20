import { DataTestRunDetail } from "@metabase/client/domain/data-test";

import { renderItem } from "../../output/render";
import { dataTestRunDetailView } from "../../output/views/data-test-run";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "get-run",
    description: "Get a data test run by run id, with the result it stored",
  },
  details:
    "The positional id is a RUN id (from `test runs`), not a test. `result` holds what each expectation found, or the `message` and `error-code` of the refusal that ended the run. It is null when the run stored none, and for a caller who may not read it (only the user who started the run and an admin may), which `can_read_result` tells apart.",
  requires: ["dataTestRun.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Run id (from `mb test runs`)", required: true },
  },
  outputSchema: DataTestRunDetail,
  examples: ["mb test get-run 31", "mb test get-run 31 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "run id");
    const client = await getClient();
    const run = await client.dataTestRun.get(id, { signal: interruptSignal });
    renderItem(run, dataTestRunDetailView, ctx);
  },
});
