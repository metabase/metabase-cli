import { Snippet, SnippetUpdateInput, snippetView } from "../../domain/snippet";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a native query snippet by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  inputSchema: SnippetUpdateInput,
  outputSchema: Snippet,
  examples: [
    "cat patch.json | mb snippet update 1",
    "mb snippet update 1 --file patch.json",
    'mb snippet update 1 --body \'{"name":"renamed"}\'',
    "mb snippet update 1 --body '{\"archived\":true}'",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, SnippetUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Snippet, `/api/native-query-snippet/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(updated, snippetView, `Updated snippet ${updated.id} "${updated.name}".`, ctx);
  },
});
