import { DataTestRunCompact, DataTestRunStatus } from "@metabase/client/domain/data-test";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowServerPage } from "../../output/window";
import { dataTestRunView } from "../../output/views/data-test-run";
import { parseEnumCsv } from "../../runtime/csv";
import {
  connectionFlags,
  listFlag,
  listFlagsWithDefaultLimit,
  outputFlags,
  profileFlag,
} from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const CardTestRunListEnvelope = listEnvelopeSchema(DataTestRunCompact);

const DEFAULT_RUN_LIMIT = 20;

export default defineMetabaseCommand({
  meta: { name: "runs", description: "List the runs of card tests, newest first" },
  details:
    "Lists the runs of every card test the caller can read, or with --test-id only those of one test. A run's `status` is `started` while it is in flight, then `passed`, `failed`, `error` or `timeout`. The runs of a deleted test are not listed.",
  requires: ["dataTestRun.list"],
  args: {
    ...outputFlags,
    ...listFlagsWithDefaultLimit(DEFAULT_RUN_LIMIT),
    ...profileFlag,
    ...connectionFlags,
    "test-id": { type: "string", description: "Only the runs of this card test id" },
    statuses: listFlag({
      type: "string",
      description: `Only runs in these states, comma separated: ${DataTestRunStatus.options.join(", ")}`,
    }),
  },
  outputSchema: CardTestRunListEnvelope,
  examples: [
    "mb card-test runs",
    "mb card-test runs --test-id 1 --json",
    "mb card-test runs --statuses failed,error --limit 50",
  ],
  async run({ args, ctx, getClient }) {
    const testId =
      args["test-id"] === undefined ? undefined : parseId(args["test-id"], "--test-id");
    const statuses = parseEnumCsv(args.statuses, DataTestRunStatus, "--statuses");
    const client = await getClient();
    const { data, total } = await client.dataTestRun.list({
      "test-type": "card",
      "test-id": testId,
      statuses,
      limit: ctx.range.limit,
      offset: ctx.range.offset,
    });
    renderList(windowServerPage(data, total, ctx.range), dataTestRunView, ctx);
  },
});
