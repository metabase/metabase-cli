import { TransformTagCompact } from "@metabase/client/domain/transform-tag";
import { transformTagView } from "../../output/views/transform-tag";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TransformTagListEnvelope = listEnvelopeSchema(TransformTagCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform tags" },
  requires: ["transformTag.list"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: TransformTagListEnvelope,
  examples: ["mb transform-tag list", "mb transform-tag list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.transformTag.list();
    renderList(windowList(data, ctx.range), transformTagView, ctx);
  },
});
