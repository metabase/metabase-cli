import { z } from "zod";

import { Segment, SegmentCompact, segmentView } from "../../domain/segment";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const SegmentApiList = z.array(Segment);

export const SegmentListEnvelope = listEnvelopeSchema(SegmentCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List segments" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SegmentListEnvelope,
  examples: ["mb segment list", "mb segment list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(SegmentApiList, "/api/segment");
    renderList(wrapList(items), segmentView, ctx);
  },
});
