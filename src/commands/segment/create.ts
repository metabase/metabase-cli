import { Segment, SegmentCreateInput, segmentView } from "../../domain/segment";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a segment from a JSON spec" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  outputSchema: Segment,
  examples: [
    "cat segment.json | metabase segment create",
    "metabase segment create --file segment.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SegmentCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Segment, "/api/segment", {
      method: "POST",
      body,
    });
    renderItem(created, segmentView, ctx);
  },
});
