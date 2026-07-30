import { Document } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a document by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Document id", required: true },
  },
  outputSchema: Document,
  examples: ["mb document get 1", "mb document get 1 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const document = await client.document.get(id);
    renderItem(document, documentView, ctx);
  },
});
