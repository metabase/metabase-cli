import { Database, databaseView } from "../../domain/database";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a database by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: Database,
  examples: ["metabase db get 1", "metabase db get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const database = await client.requestParsed(Database, `/api/database/${id}`);
    renderItem(database, databaseView, ctx);
  },
});
