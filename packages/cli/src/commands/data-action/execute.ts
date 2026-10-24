import {
  DataActionExecuteInput,
  DataActionExecuteResult,
} from "@metabase/client/domain/data-action";
import { dataActionExecuteResultView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

function executeOutcome(result: DataActionExecuteResult): string {
  if (result["created-row"] !== undefined) {
    return "created a row";
  }
  const rows = result["rows-affected"] ?? result["rows-updated"] ?? result["rows-deleted"] ?? 0;
  return `${rows} rows affected`;
}

export default defineMetabaseCommand({
  meta: { name: "execute", description: "Run a data action by id" },
  details:
    "The JSON body is `{\"parameters\": {...}}`, keyed by the data action's parameter ids; an implicit action's parameter ids are its table's column names, and an update or a delete picks its row by the primary key column. The data action writes to its database, so a run cannot be undone by the CLI. A query action answers `rows-affected`; an implicit action answers `rows-updated`, `rows-deleted`, or the `created-row`.",
  skills: [{ skill: "data-action", purpose: "the parameter values a data action takes" }],
  requires: ["dataAction.execute"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Data action id", required: true },
  },
  inputSchema: DataActionExecuteInput,
  outputSchema: DataActionExecuteResult,
  examples: [
    'mb data-action execute 1 --body \'{"parameters":{"id":1,"note":"rush"}}\'',
    "mb data-action execute 1 --file values.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const result = await client.dataAction.execute(id, body);
    renderSummary(
      result,
      dataActionExecuteResultView,
      `Ran data action ${id}; ${executeOutcome(result)}.`,
      ctx,
    );
  },
});
