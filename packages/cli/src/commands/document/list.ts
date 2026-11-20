import { DocumentCompact } from "@metabase/client/domain/document";
import { documentView } from "../../output/views/document";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DocumentListEnvelope = listEnvelopeSchema(DocumentCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List documents" },
  details:
    "Lists the documents you can see that are not archived. The compact row leaves out the document body, which can be large; read it with `document get <id> --full`.",
  requires: ["document.list"],
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: DocumentListEnvelope,
  examples: ["mb document list", "mb document list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.document.list();
    renderList(windowList(data, ctx.range, total), documentView, ctx);
  },
});
