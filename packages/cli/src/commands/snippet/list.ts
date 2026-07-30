import { SnippetCompact } from "@metabase/client/domain/snippet";
import { snippetView } from "../../output/views/snippet";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const SnippetListEnvelope = listEnvelopeSchema(SnippetCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List native query snippets" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: { type: "boolean", description: "Show archived snippets instead of active ones" },
  },
  outputSchema: SnippetListEnvelope,
  examples: ["mb snippet list", "mb snippet list --json", "mb snippet list --archived --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.snippet.list({ archived: args.archived || undefined });
    renderList(windowList(data, ctx.range, total), snippetView, ctx);
  },
});
