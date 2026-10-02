import { DataAction } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a data action by id" },
  requires: ["dataAction.archive"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Data action id", required: true },
  },
  outputSchema: DataAction,
  examples: ["mb data-action archive 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.dataAction.archive(id);
    renderSummary(
      updated,
      dataActionView,
      `Archived data action ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
