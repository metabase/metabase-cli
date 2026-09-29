import { SEARCH_MODELS, SearchModel, SearchResultCompact } from "@metabase/client/domain/search";
import { ConfigError } from "@metabase/client/errors";
import { searchResultView } from "../output/views/search";
import { renderList } from "../output/render";
import { listEnvelopeSchema } from "../output/types";
import { windowServerPage } from "../output/window";
import { parseEnumCsv } from "../runtime/csv";

import { connectionFlags, listFlagsWithDefaultLimit, outputFlags, profileFlag } from "./flags";
import { parseId, parseIdCsv } from "./parse-id";
import { defineMetabaseCommand } from "./runtime";

// Unbounded, the server ranks and then hydrates up to `max-filtered-results` (1000) rows, running
// the per-row `can_write` permission check on every one — a cost the output cap would then throw
// away. The window is the request, so it has to be sized before the request is made.
const DEFAULT_LIMIT = 20;
const SEARCH_MODELS_DESCRIPTION = `Comma-separated model filter: ${SEARCH_MODELS.join(",")}`;

export const SearchListEnvelope = listEnvelopeSchema(SearchResultCompact);

export default defineMetabaseCommand({
  meta: {
    name: "search",
    description: "Search Metabase content (cards, dashboards, collections, …)",
  },
  details:
    "Ranks content against a query string. To simply enumerate a resource, prefer its `… list` verb.",
  skills: [{ skill: "core", purpose: "search vs. list" }],
  requires: ["search.query"],
  args: {
    ...outputFlags,
    ...listFlagsWithDefaultLimit(DEFAULT_LIMIT),
    ...profileFlag,
    ...connectionFlags,
    query: {
      type: "positional",
      description: "Search query string",
      required: false,
    },
    models: {
      type: "string",
      description: SEARCH_MODELS_DESCRIPTION,
      alias: "m",
    },
    archived: {
      type: "boolean",
      description: "Search only archived items (instead of only active ones)",
      default: false,
    },
    "db-id": {
      type: "string",
      description: "Restrict to items on a given database id",
    },
    verified: {
      type: "boolean",
      description: "Only verified content",
    },
    collection: {
      type: "string",
      description:
        "Restrict to one collection by id: its own row, subcollections and the content filed under them, never segments, measures or transforms (dashboard questions need --include-dashboard-questions)",
    },
    "created-by": {
      type: "string",
      description:
        "Comma-separated user ids; matches items created by any of them (drops models with no creator)",
    },
    "search-native-query": {
      type: "boolean",
      description:
        "Also match native query text; narrows to cards, models, metrics, actions and transforms",
    },
    "include-metadata": {
      type: "boolean",
      description:
        "Attach result_metadata to card, model and metric rows (needs --full or --fields)",
    },
    "include-dashboard-questions": {
      type: "boolean",
      description: "Also match questions saved into a dashboard (excluded by default)",
    },
  },
  outputSchema: SearchListEnvelope,
  examples: [
    "mb search orders",
    "mb search --models card,dashboard --limit 10 --json",
    "mb search products --archived",
    "mb search --collection 12 --created-by 3,7 --include-dashboard-questions --json",
    "mb search revenue --search-native-query --include-metadata --full --json",
  ],
  async run({ args, ctx, getClient }) {
    const tableDbIdRaw = args["db-id"];
    const tableDbId = tableDbIdRaw === undefined ? undefined : parseId(tableDbIdRaw, "--db-id");
    const models = parseEnumCsv(args.models, SearchModel, "--models");
    const collection =
      args.collection === undefined ? undefined : parseId(args.collection, "--collection");
    const createdByRaw = args["created-by"];
    const createdBy =
      createdByRaw === undefined ? undefined : parseIdCsv(createdByRaw, "--created-by");
    const includeMetadata = args["include-metadata"] === true;
    if (includeMetadata && !ctx.full && ctx.fields === undefined) {
      throw new ConfigError(
        "--include-metadata needs --full or --fields: the compact row drops result_metadata",
      );
    }
    const client = await getClient();

    const { data, total } = await client.search.query({
      q: nonEmpty(args.query),
      models,
      archived: args.archived ? true : undefined,
      limit: ctx.range.limit,
      offset: ctx.range.offset,
      table_db_id: tableDbId,
      verified: args.verified ? true : undefined,
      collection,
      created_by: createdBy,
      search_native_query: args["search-native-query"] ? true : undefined,
      include_metadata: includeMetadata ? true : undefined,
      include_dashboard_questions: args["include-dashboard-questions"] ? true : undefined,
    });

    renderList(windowServerPage(data, total, ctx.range), searchResultView, ctx);
  },
});

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
