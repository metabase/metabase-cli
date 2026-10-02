import {
  DataActionExecuteInput,
  DataActionExecuteResult,
} from "@metabase/client/domain/data-action";
import { dataActionExecuteResultView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "execute", description: "Run a data action by id" },
  details:
    'The JSON body is `{"parameters": {...}}`, keyed by the data action\'s parameter ids. The data action writes to its database, so a run cannot be undone by the CLI.',
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
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, DataActionExecuteInput);
    const client = await getClient();
    const result = await client.dataAction.execute(id, body);
    renderSummary(
      result,
      dataActionExecuteResultView,
      `Ran data action ${id}; ${result["rows-affected"]} rows affected.`,
      ctx,
    );
  },
});
