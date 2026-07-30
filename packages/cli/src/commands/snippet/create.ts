import { Snippet, SnippetCreateInput } from "@metabase/client/domain/snippet";
import { snippetView } from "../../output/views/snippet";
import { renderSummary } from "../../output/render";
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
  inputSchema: SnippetCreateInput,
  outputSchema: Snippet,
  examples: [
    "cat snippet.json | mb snippet create",
    "mb snippet create --file snippet.json",
    'mb snippet create --body \'{"name":"active","content":"WHERE active = true"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SnippetCreateInput);
    const client = await getClient();
    const created = await client.snippet.create(body);
    renderSummary(created, snippetView, `Created snippet ${created.id} "${created.name}".`, ctx);
  },
});
