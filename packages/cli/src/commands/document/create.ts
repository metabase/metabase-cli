import { Document, DocumentCreateInput } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a document" },
  details:
    "Body keys: `name` (required), `document` (required, the TipTap `doc` tree), `collection_id` (`null` files it under **Our analytics**) and `collection_position`. A `cardEmbed` node can create a card with the document: give it a negative ID, and put the card's definition in a top-level `cards` map under that ID.",
  requires: ["document.create"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  inputSchema: DocumentCreateInput,
  outputSchema: Document,
  examples: [
    "cat doc.json | mb document create",
    "mb document create --file doc.json",
    'mb document create --body \'{"name":"Notes","document":{"type":"doc","content":[]}}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.document.create(body);
    renderSummary(created, documentView, `Created document ${created.id} "${created.name}".`, ctx);
  },
});
