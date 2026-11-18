import { SegmentTest, SegmentTestUpdateInput } from "@metabase/client/domain/segment-test";

import { renderSummary } from "../../output/render";
import { segmentTestView } from "../../output/views/segment-test";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a segment test from JSON" },
  details:
    "Only the fields the body carries are patched. `inputs` and `expectations` replace what is stored rather than merging into it. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` before it can be sent.",
  requires: ["segmentTest.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Segment test id", required: true },
  },
  inputSchema: SegmentTestUpdateInput,
  outputSchema: SegmentTest,
  examples: [
    "cat patch.json | mb segment-test update 1",
    "mb segment-test update 1 --file patch.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.segmentTest.update(id, body);
    renderSummary(updated, segmentTestView, `Updated segment test ${updated.id}.`, ctx);
  },
});
