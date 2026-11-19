import {
  DATA_TEST_TYPES,
  DataTestRunCompact,
  DataTestRunStatus,
  DataTestType,
} from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { dataTestRunView } from "../../output/views/data-test-run";
import { windowServerPage } from "../../output/window";
import { parseEnumCsv } from "../../runtime/csv";
import { interruptSignal } from "../../runtime/interrupt";
import {
  connectionFlags,
  listFlag,
  listFlagsWithDefaultLimit,
  outputFlags,
  profileFlag,
} from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";
import { parseTestRef } from "../test-ref";

export const TestRunListEnvelope = listEnvelopeSchema(DataTestRunCompact);

const DEFAULT_RUN_LIMIT = 20;

interface RunScope {
  type: DataTestType;
  testId: number | undefined;
}

function runScope(id: string | undefined, type: string | undefined): RunScope {
  if (id !== undefined && type !== undefined) {
    throw new ConfigError("pass --id or --type, not both");
  }
  if (id !== undefined) {
    const ref = parseTestRef(id);
    return { type: ref.type, testId: ref.id };
  }
  if (type !== undefined) {
    return { type: parseEnumFlag(type, DataTestType, "--type"), testId: undefined };
  }
  throw new ConfigError("pass --id for the runs of one test, or --type for those of a test type");
}

export default defineMetabaseCommand({
  meta: { name: "runs", description: "List the runs of data tests, newest first" },
  details:
    "Lists the runs of one test with --id, or of every test of one type with --type. A run's `status` is `started` while it is in flight, then `passed`, `failed`, `error` or `timeout`. The runs of a deleted test are not listed.",
  requires: ["dataTestRun.list"],
  args: {
    ...outputFlags,
    ...listFlagsWithDefaultLimit(DEFAULT_RUN_LIMIT),
    ...profileFlag,
    ...connectionFlags,
    id: { type: "string", description: "Only the runs of this test, such as card-test:34" },
    type: {
      type: "string",
      description: `The runs of every test of this type: ${DATA_TEST_TYPES.join(", ")}`,
    },
    statuses: listFlag({
      type: "string",
      description: `Only runs in these states, comma separated: ${DataTestRunStatus.options.join(", ")}`,
    }),
  },
  outputSchema: TestRunListEnvelope,
  examples: [
    "mb test runs --id card-test:34",
    "mb test runs --type card --json",
    "mb test runs --type transform --statuses failed,error --limit 50",
  ],
  async run({ args, ctx, getClient }) {
    const scope = runScope(args.id, args.type);
    const statuses = parseEnumCsv(args.statuses, DataTestRunStatus, "--statuses");
    const client = await getClient();
    const { data, total } = await client.dataTestRun.list(
      {
        "test-type": scope.type,
        "test-id": scope.testId,
        statuses,
        limit: ctx.range.limit,
        offset: ctx.range.offset,
      },
      { signal: interruptSignal },
    );
    renderList(windowServerPage(data, total, ctx.range), dataTestRunView, ctx);
  },
});
