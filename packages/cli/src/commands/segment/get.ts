import { Segment } from "@metabase/client/domain/segment";
import { segmentView } from "../../output/views/segment";
import { renderItem } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a segment by id" },
  requires: ["segment.get"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Segment id", required: true },
  },
  outputSchema: Segment,
  examples: ["mb segment get 1", "mb segment get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const segment = await client.segment.get(id);
    renderItem(segment, segmentView, ctx);
  },
});
