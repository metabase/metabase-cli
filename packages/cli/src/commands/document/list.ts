import { z } from "zod";

import { Document, DocumentCompact, documentView } from "../../domain/document";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const DocumentApiList = z.object({ items: z.array(Document) }).loose();

export const DocumentListEnvelope = listEnvelopeSchema(DocumentCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List documents" },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: DocumentListEnvelope,
  examples: ["mb document list", "mb document list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const response = await client.requestParsed(DocumentApiList, "/api/document");
    renderList(wrapList(response.items), documentView, ctx);
  },
});
