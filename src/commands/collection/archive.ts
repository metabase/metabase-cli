import { Collection, collectionView } from "../../domain/collection";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a collection by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Collection id", required: true },
  },
  outputSchema: Collection,
  examples: ["mb collection archive 4", "mb collection archive 4 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Collection, `/api/collection/${id}`, {
      method: "PUT",
      body: { archived: true },
    });
    renderSummary(
      updated,
      collectionView,
      `Archived collection ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
