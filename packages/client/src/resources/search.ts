import { z } from "zod";

import { type SearchModel, SearchResult } from "../domain/search";
import type { RequestOptions, Transport } from "../http/transport";

// `GET /api/search` applies the window itself and reports the count across the whole result set,
// so `total` is the server's and never the returned slice's length. It is required rather than
// nullable — a server page that cannot say whether more rows remain leaves a caller unable to page.
export interface SearchPage {
  data: SearchResult[];
  total: number;
}

const SearchApiResponse = z
  .object({
    data: z.array(SearchResult),
    total: z.number().int().nonnegative(),
  })
  .loose();

export interface SearchParams {
  q?: string | undefined;
  models?: ReadonlyArray<SearchModel> | undefined;
  archived?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  table_db_id?: number | undefined;
  verified?: boolean | undefined;
  collection?: number | undefined;
  created_by?: ReadonlyArray<number> | undefined;
  search_native_query?: boolean | undefined;
  include_metadata?: boolean | undefined;
  include_dashboard_questions?: boolean | undefined;
}

export function searchResource(transport: Transport) {
  /**
   * Search over the instance's content, ranked against `q`. `models` narrows which kinds of entity
   * may match, `archived` swaps the active set for the archived one, `table_db_id` restricts to
   * items on one database, `verified` to verified content, `collection` to one collection and its
   * descendants, `created_by` to items created by any of those users, `search_native_query` also
   * matches native query text but narrows to the models that carry one (cards, models, metrics,
   * actions, transforms), `include_metadata` attaches each card's `result_metadata`,
   * `include_dashboard_questions` also matches questions saved into a dashboard (excluded by
   * default), and `limit`/`offset` are the window the server applies before ranking hydration.
   * `verified` needs the `content_verification` premium feature, and is refused before the wire
   * without it.
   */
  async function query(
    params: SearchParams = {},
    options: RequestOptions = {},
  ): Promise<SearchPage> {
    // A server without content verification drops the filter and answers unverified results as
    // if they had been filtered.
    if (params.verified === true) {
      await transport.requireFeatures(["contentVerification"], options);
    }
    const response = await transport.requestParsed(SearchApiResponse, "/api/search", {
      ...options,
      query: {
        q: params.q,
        models: params.models,
        archived: params.archived,
        limit: params.limit,
        offset: params.offset,
        table_db_id: params.table_db_id,
        verified: params.verified,
        collection: params.collection,
        created_by: params.created_by,
        search_native_query: params.search_native_query,
        include_metadata: params.include_metadata,
        include_dashboard_questions: params.include_dashboard_questions,
      },
    });
    return { data: response.data, total: response.total };
  }

  return { query };
}
