import { Database, DatabaseCreateInput } from "@metabase/client/domain/database";
import { renderSummary } from "../../output/render";
import { databaseView } from "../../output/views/database";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Add a database connection from JSON" },
  details:
    "The body is `{name, engine, details}`: `engine` is the driver (`postgres`, `bigquery-cloud-sdk`, `snowflake`, …) and `details` its connection settings, the keys the driver's form in Admin → Databases asks for. The server tests the connection before saving it and refuses one it cannot open; a saved database starts its first sync. Keep secrets out of shell history: pass the body with `--file` or on stdin. Admins only.",
  requires: ["database.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: DatabaseCreateInput,
  outputSchema: Database,
  examples: ["mb db create --file database.json", "cat database.json | mb db create --json"],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.database.create(body);
    renderSummary(created, databaseView, `Created database ${created.id} "${created.name}".`, ctx);
  },
});
