import { ApiKeyCompact } from "@metabase/client/domain/api-key";
import { apiKeyView } from "../../output/views/api-key";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const ApiKeyListEnvelope = listEnvelopeSchema(ApiKeyCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List API keys" },
  details: "Each shows its masked key.",
  requires: ["apiKey.list"],
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: ApiKeyListEnvelope,
  examples: ["mb api-key list", "mb api-key list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.apiKey.list();
    renderList(windowList(data, ctx.range, total), apiKeyView, ctx);
  },
});
