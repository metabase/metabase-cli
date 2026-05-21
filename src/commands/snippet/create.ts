import { Snippet, SnippetCreateInput, snippetView } from "../../domain/snippet";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a native query snippet from a JSON spec" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  outputSchema: Snippet,
  examples: [
    "cat snippet.json | mb snippet create",
    "mb snippet create --file snippet.json",
    'mb snippet create --body \'{"name":"active","content":"WHERE active = true"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SnippetCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Snippet, "/api/native-query-snippet", {
      method: "POST",
      body,
    });
    renderItem(created, snippetView, ctx);
  },
});
