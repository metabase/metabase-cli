import { Snippet, snippetView } from "../../domain/snippet";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a native query snippet by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  outputSchema: Snippet,
  examples: ["mb snippet archive 1", "mb snippet archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Snippet, `/api/native-query-snippet/${id}`, {
      method: "PUT",
      body: { archived: true },
    });
    renderItem(updated, snippetView, ctx);
  },
});
