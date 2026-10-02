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
  requires: ["dataAction.list"],
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: DataActionListEnvelope,
  examples: ["mb data-action list", "mb data-action list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.dataAction.list();
    renderList(windowList(data, ctx.range, total), dataActionView, ctx);
  },
});
