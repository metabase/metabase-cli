import { MeasureCompact } from "@metabase/client/domain/measure";
import { measureView } from "../../output/views/measure";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const MeasureListEnvelope = listEnvelopeSchema(MeasureCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List measures" },
  requires: ["measure.list"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: MeasureListEnvelope,
  examples: ["mb measure list", "mb measure list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.measure.list();
    renderList(windowList(data, ctx.range, total), measureView, ctx);
  },
});
