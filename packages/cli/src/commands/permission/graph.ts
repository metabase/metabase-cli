import { ConfigError } from "@metabase/client/errors";
import { PermissionsGraph } from "@metabase/client/domain/permission";
import { writeJson } from "../../output/render";
import { connectionFlags, formatFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "graph",
    description: "Get the data permissions graph (JSON only)",
  },
  details:
    "The graph is keyed by group id, then database id. A permission holds one value for a whole database, one per schema, or one per table id under a schema; a permission left out is at its least permissive value. `revision` is what `mb permission update-graph` must send back. Admins only. `--db` reads one database, `--group` one group.",
  requires: ["permission.graph", "permission.databaseGraph", "permission.groupGraph"],
  args: {
    ...formatFlags,
    ...profileFlag,
    ...connectionFlags,
    db: { type: "string", description: "Only this database id" },
    group: { type: "string", description: "Only this group id" },
  },
  outputSchema: PermissionsGraph,
  examples: [
    "mb permission graph",
    "mb permission graph --db 2",
    "mb permission graph --group 3 --json",
  ],
  async run({ args, ctx, getClient }) {
    if (ctx.format === "text") {
      throw new ConfigError("permission graph output is JSON-only; --format text is not supported");
    }
    if (args.db !== undefined && args.group !== undefined) {
      throw new ConfigError("--db cannot be combined with --group");
    }
    const db = args.db === undefined ? undefined : parseId(args.db, "--db");
    const group = args.group === undefined ? undefined : parseId(args.group, "--group");
    const client = await getClient();
    if (db !== undefined) {
      writeJson(await client.permission.databaseGraph(db));
    } else if (group !== undefined) {
      writeJson(await client.permission.groupGraph(group));
    } else {
      writeJson(await client.permission.graph());
    }
  },
});
