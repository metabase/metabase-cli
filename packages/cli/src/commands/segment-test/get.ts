import { SegmentTest } from "@metabase/client/domain/segment-test";

import { renderItem } from "../../output/render";
import { segmentTestView } from "../../output/views/segment-test";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a segment test by id" },
  details:
    "The compact form carries the id, segment, name and description. Pass --full for the `inputs` and `expectations` themselves and the test's newest run as `last_run`, which is also the body to edit and send back to `update` once `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` are shed.",
  requires: ["segmentTest.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Segment test id", required: true },
  },
  outputSchema: SegmentTest,
  examples: ["mb segment-test get 1", "mb segment-test get 1 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const segmentTest = await client.segmentTest.get(id);
    renderItem(segmentTest, segmentTestView, ctx);
  },
});
