import { SEARCH_MODELS, SearchModel, SearchResultCompact } from "@metabase/client/domain/search";
import { searchResultView } from "../output/views/search";
import { renderList } from "../output/render";
import { listEnvelopeSchema } from "../output/types";
import { windowServerPage } from "../output/window";
import { parseEnumCsv } from "../runtime/csv";

import { connectionFlags, listFlagsWithDefaultLimit, outputFlags, profileFlag } from "./flags";
import { parseId } from "./parse-id";
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
  capabilities: { minVersion: 58 },
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
  },
  outputSchema: SearchListEnvelope,
  examples: [
    "mb search orders",
    "mb search --models card,dashboard --limit 10 --json",
    "mb search products --archived",
  ],
  async run({ args, ctx, getClient }) {
    const tableDbIdRaw = args["db-id"];
    const tableDbId = tableDbIdRaw ? parseId(tableDbIdRaw, "--db-id") : undefined;
    const models = parseEnumCsv(args.models, SearchModel, "--models");
    const client = await getClient();

    const { data, total } = await client.search.query({
      q: nonEmpty(args.query),
      models,
      archived: args.archived ? true : undefined,
      limit: ctx.range.limit,
      offset: ctx.range.offset,
      table_db_id: tableDbId,
      verified: args.verified ? true : undefined,
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
