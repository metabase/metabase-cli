import { Segment, segmentView } from "../../domain/segment";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { revisionMessageFlag } from "../revision-message-flag";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a segment by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...revisionMessageFlag,
    id: { type: "positional", description: "Segment id", required: true },
  },
  outputSchema: Segment,
  examples: [
    "metabase segment archive 1",
    'metabase segment archive 1 --revision-message "deprecated"',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Segment, `/api/segment/${id}`, {
      method: "PUT",
      body: { archived: true, revision_message: args.revisionMessage },
    });
    renderItem(updated, segmentView, ctx);
  },
});
