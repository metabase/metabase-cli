import { TransformCompact } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TransformListEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transforms" },
  requires: ["transform.list"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: TransformListEnvelope,
  examples: ["mb transform list", "mb transform list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.transform.list();
    renderList(windowList(data, ctx.range), transformView, ctx);
  },
});
