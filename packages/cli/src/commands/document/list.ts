import { DocumentCompact } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DocumentListEnvelope = listEnvelopeSchema(DocumentCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List documents" },
  requires: ["document.list"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: DocumentListEnvelope,
  examples: ["mb document list", "mb document list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.document.list();
    renderList(windowList(data, ctx.range, total), documentView, ctx);
  },
});
