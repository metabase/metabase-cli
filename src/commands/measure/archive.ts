import { Measure, measureView } from "../../domain/measure";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { revisionMessageFlag } from "../revision-message-flag";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a measure by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...revisionMessageFlag,
    id: { type: "positional", description: "Measure id", required: true },
  },
  outputSchema: Measure,
  examples: ["mb measure archive 1", 'mb measure archive 1 --revision-message "deprecated"'],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Measure, `/api/measure/${id}`, {
      method: "PUT",
      body: { archived: true, revision_message: args.revisionMessage },
    });
    renderItem(updated, measureView, ctx);
  },
});
