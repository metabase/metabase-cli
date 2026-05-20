import { Snippet, snippetView } from "../../domain/snippet";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a native query snippet by id" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  outputSchema: Snippet,
  examples: ["mb snippet get 1", "mb snippet get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const snippet = await client.requestParsed(Snippet, `/api/native-query-snippet/${id}`);
    renderItem(snippet, snippetView, ctx);
  },
});
