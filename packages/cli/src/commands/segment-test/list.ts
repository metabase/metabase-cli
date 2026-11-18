import { SegmentTestCompact } from "@metabase/client/domain/segment-test";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { segmentTestView } from "../../output/views/segment-test";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const SegmentTestListEnvelope = listEnvelopeSchema(SegmentTestCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List segment tests" },
  requires: ["segmentTest.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "segment-id": { type: "string", description: "Only the tests of this segment id" },
  },
  outputSchema: SegmentTestListEnvelope,
  examples: ["mb segment-test list", "mb segment-test list --segment-id 1 --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const segmentId =
      args["segment-id"] === undefined ? undefined : parseId(args["segment-id"], "--segment-id");
    const { data } = await client.segmentTest.list({ "segment-id": segmentId });
    renderList(windowList(data, ctx.range), segmentTestView, ctx);
  },
});
