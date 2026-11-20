import {
  DATA_LAYER_TIER_GATE,
  TABLE_LIST_FILTER_FEATURES,
  TableCompact,
  TableDataLayer,
  TableDataLayerMedallion,
  TableDataLayerTier,
  TableDataSource,
  TableVisibilityType,
} from "@metabase/client/domain/table";
import { featureAvailability } from "@metabase/client/version/features";
import { tableView } from "../../output/views/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TableListEnvelope = listEnvelopeSchema(TableCompact);

type TableListFilter = (typeof TABLE_LIST_FILTER_FEATURES)[number][0];

function filterNeeds(filter: TableListFilter): string {
  const entry = TABLE_LIST_FILTER_FEATURES.find(([name]) => name === filter);
  if (entry === undefined) {
    throw new Error(`--${filter} names no gated table list filter`);
  }
  const [, feature] = entry;
  return `needs \`${feature}\` (${featureAvailability(feature)})`;
}

export default defineMetabaseCommand({
  meta: { name: "list", description: "List tables, optionally filtered" },
  details:
    "Returns a flat compact list without fields; when you know the schema, `mb db schema-tables <db-id> <schema>` is the better starting point. `--db-id` narrows the list on the client; every other filter is applied by the server. `--unused-only`, `--published-only`, `--can-query`, `--can-write` and `--include-transform-targets` are refused before the request (exit 2) on a server without the feature the flag needs, because such a server drops a filter it doesn't know without a word.",
  requires: ["table.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "db-id": { type: "string", description: "Filter by database id" },
    term: {
      type: "string",
      description:
        "Match table names and display names by prefix, and display names by the start of any word too (`ite` matches Order Items); `*` is a wildcard",
    },
    "visibility-type": {
      type: "string",
      description: `Only tables with this visibility: ${TableVisibilityType.options.join("|")}`,
    },
    "data-layer": {
      type: "string",
      description: `Only tables in this data layer: ${TableDataLayerTier.options.join("|")}; a server without \`${DATA_LAYER_TIER_GATE.feature}\` (${featureAvailability(DATA_LAYER_TIER_GATE.feature)}) names them ${TableDataLayerMedallion.options.join("|")}`,
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
      description: `Only tables nothing depends on; ${filterNeeds("unused-only")}`,
    },
    "published-only": {
      type: "boolean",
      description: `Only tables published to the library; ${filterNeeds("published-only")}`,
    },
    "can-query": {
      type: "boolean",
      description: `Only tables you can run queries against; ${filterNeeds("can-query")}`,
    },
    "can-write": {
      type: "boolean",
      description: `Only tables whose metadata you can edit; ${filterNeeds("can-write")}`,
    },
    "include-transform-targets": {
      type: "boolean",
      description: `Also list the inactive tables a transform writes to, which carry \`active: false\`; ${filterNeeds("include-transform-targets")}`,
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
      "published-only": args["published-only"] ? true : undefined,
      "can-query": args["can-query"] ? true : undefined,
      "can-write": args["can-write"] ? true : undefined,
      "include-transform-targets": args["include-transform-targets"] ? true : undefined,
    });
    const filtered =
      dbIdFilter === undefined ? data : data.filter((row) => row.db_id === dbIdFilter);
    renderList(windowList(filtered, ctx.range), tableView, ctx);
  },
});
