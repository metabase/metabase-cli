import { z } from "zod";

import { Snippet, SnippetCompact, snippetView } from "../../domain/snippet";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const SnippetApiList = z.array(Snippet);

export const SnippetListEnvelope = listEnvelopeSchema(SnippetCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List native query snippets" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: { type: "boolean", description: "Show archived snippets instead of active ones" },
  },
  outputSchema: SnippetListEnvelope,
  examples: [
    "metabase snippet list",
    "metabase snippet list --json",
    "metabase snippet list --archived --json",
  ],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(SnippetApiList, "/api/native-query-snippet", {
      query: { archived: args.archived || undefined },
    });
    renderList(wrapList(items), snippetView, ctx);
  },
});
