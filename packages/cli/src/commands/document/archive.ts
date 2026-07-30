import { Document } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a document by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Document id", required: true },
  },
  outputSchema: Document,
  examples: ["mb document archive 1", "mb document archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.document.archive(id);
    renderSummary(updated, documentView, `Archived document ${updated.id} "${updated.name}".`, ctx);
  },
});
