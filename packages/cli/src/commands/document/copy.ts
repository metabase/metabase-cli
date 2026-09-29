import { Document } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderSummary } from "../../output/render";
import { copyFlags, parseCopyFlags } from "../copy-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "copy",
    description: "Copy a document, with the cards saved inside it, into a collection",
  },
  details:
    "The copy duplicates the cards saved inside the document into the target collection and carries the source body with their embeds pointing at the duplicates. Without --collection-id the copy lands in the root collection. An archived source is not found.",
  requires: ["document.copy"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...copyFlags,
    id: { type: "positional", description: "Document id", required: true },
  },
  outputSchema: Document,
  examples: [
    "mb document copy 1",
    'mb document copy 1 --collection-id 4 --name "Notes (copy)" --json',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const target = parseCopyFlags(args);
    const client = await getClient();
    const copied = await client.document.copy(id, target);
    renderSummary(
      copied,
      documentView,
      `Copied document ${id} to ${copied.id} "${copied.name}".`,
      ctx,
    );
  },
});
