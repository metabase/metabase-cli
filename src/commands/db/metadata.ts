import { Database, databaseView } from "../../domain/database";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "metadata",
    description: "Get a database with its tables and fields hydrated",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: Database,
  examples: ["mb db metadata 1", "mb db metadata 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const database = await client.requestParsed(Database, `/api/database/${id}/metadata`);
    renderItem(database, databaseView, ctx);
  },
});
