import { z } from "zod";

import { Database, databaseView } from "../../domain/database";
import { renderItem } from "../../output/render";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const DatabaseGetInclude = z.enum(["tables", "tables.fields"]);

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a database by id" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    include: {
      type: "string",
      description: `Hydrate related entities: ${DatabaseGetInclude.options.join("|")}`,
    },
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: Database,
  examples: ["mb db get 1", "mb db get 1 --json", "mb db get 1 --include tables.fields --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const include = parseEnum(args.include, DatabaseGetInclude, "--include");
    const client = await getClient();
    const database = await client.requestParsed(Database, `/api/database/${id}`, {
      query: { include },
    });
    renderItem(database, databaseView, ctx);
  },
});
