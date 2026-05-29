import { Document, DocumentUpdateInput, documentView } from "../../domain/document";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { normalizeDocumentBody } from "./normalize";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a document by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Document id", required: true },
  },
  outputSchema: Document,
  examples: [
    "cat patch.json | mb document update 1",
    "mb document update 1 --file patch.json",
    'mb document update 1 --body \'{"name":"Renamed"}\'',
    "mb document update 1 --body '{\"archived\":false}'",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, DocumentUpdateInput);
    if (body.document !== undefined) {
      body.document = normalizeDocumentBody(body.document);
    }
    const client = await getClient();
    const updated = await client.requestParsed(Document, `/api/document/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(updated, documentView, `Updated document ${updated.id} "${updated.name}".`, ctx);
  },
});
