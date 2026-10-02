import { DataAction } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a data action by id" },
  requires: ["dataAction.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Data action id", required: true },
  },
  outputSchema: DataAction,
  examples: ["mb data-action get 1", "mb data-action get 1 --json --full"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const dataAction = await client.dataAction.get(id);
    renderItem(dataAction, dataActionView, ctx);
  },
});
