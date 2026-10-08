import { DataActionCompact } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DataActionListEnvelope = listEnvelopeSchema(DataActionCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List data actions" },
  details:
    "Lists the data actions the caller can see, unarchived unless --archived is passed. A data action in the data actions tree has `model_id: null`; one attached to a model carries its `model_id` and sits in the model's collection.",
  requires: ["dataAction.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: {
      type: "boolean",
      description: "List archived data actions instead of unarchived ones",
    },
  },
  outputSchema: DataActionListEnvelope,
  examples: ["mb data-action list", "mb data-action list --json", "mb data-action list --archived"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.dataAction.list({
      archived: args.archived ? true : undefined,
    });
    renderList(windowList(data, ctx.range, total), dataActionView, ctx);
  },
});
