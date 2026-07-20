import { z } from "zod";

import { Database, databaseView } from "../../domain/database";
import { renderItem } from "../../output/render";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { fullRollupOversizeHint, tableMapOversizeHint } from "./hints";

const DatabaseGetInclude = z.enum(["tables", "tables.fields"]);

function includeOversizeHint(
  include: z.infer<typeof DatabaseGetInclude> | undefined,
  id: number,
): string | undefined {
  if (include === "tables.fields") {
    return fullRollupOversizeHint(id);
  }
  if (include === "tables") {
    return tableMapOversizeHint(id);
  }
  return undefined;
}

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a database by id" },
  details:
    "`--include tables` returns the table map (id, name, schema, description per table) — one call that fits most databases. `--include tables.fields` is the full rollup; on all but small databases prefer the map plus `mb table fields <table-id>` per table of interest.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    include: {
      type: "string",
      description: `Hydrate related entities: ${DatabaseGetInclude.options.join("|")}. tables is the compact table map; tables.fields adds every field — fine for small databases, use the map plus table fields <id> for large ones`,
    },
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: Database,
  examples: [
    "mb db get 1",
    "mb db get 1 --json",
    "mb db get 1 --include tables --json",
    "mb db get 1 --include tables.fields --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const include = parseEnum(args.include, DatabaseGetInclude, "--include");
    const client = await getClient();
    const database = await client.requestParsed(Database, `/api/database/${id}`, {
      query: { include },
    });
    renderItem(database, databaseView, { ...ctx, oversizeHint: includeOversizeHint(include, id) });
  },
});
