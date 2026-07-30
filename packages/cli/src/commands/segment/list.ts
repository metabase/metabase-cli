import { SegmentCompact } from "@metabase/client/domain/segment";
import { segmentView } from "../../output/views/segment";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SegmentListEnvelope = listEnvelopeSchema(SegmentCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List segments" },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SegmentListEnvelope,
  examples: ["mb segment list", "mb segment list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.segment.list();
    renderList(windowList(data, ctx.range, total), segmentView, ctx);
  },
});
