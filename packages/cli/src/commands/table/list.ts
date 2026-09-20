import {
  TableCompact,
  TableDataLayer,
  TableDataSource,
  TableVisibilityType,
} from "@metabase/client/domain/table";
import { tableView } from "../../output/views/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TableListEnvelope = listEnvelopeSchema(TableCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List tables, optionally filtered" },
  requires: ["table.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "db-id": { type: "string", description: "Filter by database id" },
    term: {
      type: "string",
      description: "Match table names and display names by prefix (`*` is a wildcard)",
    },
    "visibility-type": {
      type: "string",
      description: `Only tables with this visibility: ${TableVisibilityType.options.join("|")}`,
    },
    "data-layer": {
      type: "string",
      description: `Only tables in this data layer: ${TableDataLayer.options.join("|")}`,
    },
    "data-source": {
      type: "string",
      description: `Only tables from this data source: ${TableDataSource.options.join("|")}`,
    },
    "owner-user-id": { type: "string", description: "Only tables owned by this user id" },
    "owner-email": { type: "string", description: "Only tables owned by this email" },
    "orphan-only": { type: "boolean", description: "Only tables with no owner" },
    "unused-only": {
      type: "boolean",
      description: "Only tables nothing depends on (needs the dependencies feature)",
    },
    "can-query": { type: "boolean", description: "Only tables you can run queries against" },
    "can-write": { type: "boolean", description: "Only tables whose metadata you can edit" },
    "include-transform-targets": {
      type: "boolean",
      description: "Also list the inactive tables a transform writes to",
    },
  },
  outputSchema: TableListEnvelope,
  examples: [
    "mb table list",
    "mb table list --db-id 1 --json",
    "mb table list --term order --can-query --json",
    "mb table list --data-layer hidden --orphan-only --json",
  ],
  async run({ args, ctx, getClient }) {
    const dbIdFilter = args["db-id"] === undefined ? undefined : parseId(args["db-id"], "--db-id");
    const ownerUserId =
      args["owner-user-id"] === undefined
        ? undefined
        : parseId(args["owner-user-id"], "--owner-user-id");
    const client = await getClient();
    const { data } = await client.table.list({
      term: args.term,
      "visibility-type": parseEnum(
        args["visibility-type"],
        TableVisibilityType,
        "--visibility-type",
      ),
      "data-layer": parseEnum(args["data-layer"], TableDataLayer, "--data-layer"),
      "data-source": parseEnum(args["data-source"], TableDataSource, "--data-source"),
      "owner-user-id": ownerUserId,
      "owner-email": args["owner-email"],
      "orphan-only": args["orphan-only"] ? true : undefined,
      "unused-only": args["unused-only"] ? true : undefined,
      "can-query": args["can-query"] ? true : undefined,
      "can-write": args["can-write"] ? true : undefined,
      "include-transform-targets": args["include-transform-targets"] ? true : undefined,
    });
    const filtered =
      dbIdFilter === undefined ? data : data.filter((row) => row.db_id === dbIdFilter);
    renderList(windowList(filtered, ctx.range), tableView, ctx);
  },
});
