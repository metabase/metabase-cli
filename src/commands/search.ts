import { z } from "zod";

import {
  SEARCH_MODELS,
  SearchModel,
  SearchResult,
  SearchResultCompact,
  searchResultView,
} from "../domain/search";
import { renderList } from "../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../output/types";
import { parseEnumCsv } from "../runtime/csv";

import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { parseId } from "./parse-id";
import { defineMetabaseCommand } from "./runtime";

const DEFAULT_LIMIT = 20;
const SEARCH_MODELS_DESCRIPTION = `Comma-separated model filter: ${SEARCH_MODELS.join(",")}`;

const SearchApiResponse = z
  .object({
    data: z.array(SearchResult),
    total: z.number().int().nonnegative(),
    limit: z.number().int().nullable(),
  })
  .loose();

export const SearchListEnvelope = listEnvelopeSchema(SearchResultCompact);

export default defineMetabaseCommand({
  meta: {
    name: "search",
    description: "Search Metabase content (cards, dashboards, collections, …)",
  },
  args: {
    ...outputFlags,
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
      description: "Include archived items",
      default: false,
    },
    limit: {
      type: "string",
      description: "Max results to return",
      default: String(DEFAULT_LIMIT),
    },
    "table-db-id": {
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
    const limit = parseId(args.limit, "--limit");
    const tableDbIdRaw = args["table-db-id"];
    const tableDbId = tableDbIdRaw ? parseId(tableDbIdRaw, "--table-db-id") : undefined;
    const models = parseEnumCsv(args.models, SearchModel, "--models");
    const client = await getClient();

    const response = await client.requestParsed(SearchApiResponse, "/api/search", {
      query: {
        q: nonEmpty(args.query),
        models,
        archived: args.archived ? true : undefined,
        limit,
        table_db_id: tableDbId,
        verified: args.verified ? true : undefined,
      },
    });

    const envelope: ListEnvelope<SearchResult> = {
      data: response.data,
      returned: response.data.length,
      total: response.total,
      limit: response.limit ?? undefined,
    };
    renderList(envelope, searchResultView, ctx);
  },
});

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
