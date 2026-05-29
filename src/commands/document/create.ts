import { Document, DocumentCreateInput, documentView } from "../../domain/document";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a document" },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Document,
  examples: [
    "cat doc.json | mb document create",
    "mb document create --file doc.json",
    'mb document create --body \'{"name":"Notes","document":{"type":"doc","content":[]}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, DocumentCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Document, "/api/document", {
      method: "POST",
      body,
    });
    renderSummary(created, documentView, `Created document ${created.id} "${created.name}".`, ctx);
  },
});
