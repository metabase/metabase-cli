import { Snippet, SnippetUpdateInput, snippetView } from "../../domain/snippet";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a native query snippet by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  outputSchema: Snippet,
  examples: [
    "cat patch.json | metabase snippet update 1",
    "metabase snippet update 1 --file patch.json",
    'metabase snippet update 1 --body \'{"name":"renamed"}\'',
    "metabase snippet update 1 --body '{\"archived\":true}'",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, SnippetUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Snippet, `/api/native-query-snippet/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, snippetView, ctx);
  },
});
