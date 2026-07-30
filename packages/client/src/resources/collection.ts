import { z } from "zod";

import {
  Collection,
  type CollectionCreateInput,
  type CollectionId,
  CollectionItem,
  type CollectionItemFilterModel,
  type CollectionListFilter,
  type CollectionPinnedState,
  CollectionTreeNode,
  type CollectionUpdateInput,
} from "../domain/collection";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";

// `GET /api/collection` and `GET /api/collection/tree` both answer a bare array rather than a
// `{ data, total }` envelope, so the count a caller reads off `ListResult` is the array's own
// length and the server reports none.
const CollectionApiList = z.array(Collection);
const CollectionTreeApiList = z.array(CollectionTreeNode);

// Each preset is a distinct server-side query rather than a flag the caller composes: `all` sends
// nothing, and the other two send the one parameter Metabase reads for that view.
const COLLECTION_LIST_QUERY = {
  all: {},
  archived: { archived: true },
  personal: { "personal-only": true },
} as const;

const DEFAULT_LIST_FILTER = "all";

export interface CollectionListParams {
  filter?: CollectionListFilter | undefined;
}

export interface CollectionItemListParams {
  models?: CollectionItemFilterModel[] | undefined;
  archived?: boolean | undefined;
  pinned_state?: CollectionPinnedState | undefined;
}

// The walk's own settings, minus the query the method builds from `CollectionItemListParams`.
export type CollectionItemPageOptions = Omit<PaginateOptions, "query">;

// A collection is reachable by numeric id, by 21-character entity id, and by the aliases `root`
// and `trash`, so every ref reaches the path through `encodeURIComponent`.
function refPath(ref: CollectionId): string {
  return encodeURIComponent(ref);
}

/**
 * List collections including the Library and its children, parsing each through the caller's own
 * projection. `Collection` pins `type`, `namespace` and `authority_level` to closed enums, so a
 * consumer reading a few fields off every collection on the instance narrows here: one collection
 * carrying a server value outside those sets then costs nothing to a caller that never reads the
 * field.
 */
export async function listCollectionsWithLibrary<T>(
  transport: Transport,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T[]> {
  return transport.requestParsed(z.array(schema), "/api/collection", {
    ...options,
    query: { "include-library": true },
  });
}

export function collectionResource(transport: Transport) {
  /** List collections. `filter` picks a server-side preset: everything, archived, or personal. */
  async function list(
    params: CollectionListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Collection>> {
    const data = await transport.requestParsed(CollectionApiList, "/api/collection", {
      ...options,
      query: COLLECTION_LIST_QUERY[params.filter ?? DEFAULT_LIST_FILTER],
    });
    return { data, total: null };
  }

  /**
   * List collections including the Library and its children, which the plain listing omits.
   * The Library's own children carry neither `type` nor `is_remote_synced`, so this is where a
   * caller resolves both.
   */
  async function listWithLibrary(options: RequestOptions = {}): Promise<ListResult<Collection>> {
    const data = await listCollectionsWithLibrary(transport, Collection, options);
    return { data, total: null };
  }

  /** Get one collection by id, entity id, or the `root`/`trash` alias. */
  async function get(ref: CollectionId, options: RequestOptions = {}): Promise<Collection> {
    return transport.requestParsed(Collection, `/api/collection/${refPath(ref)}`, { ...options });
  }

  /** Create a new collection. */
  async function create(
    params: CollectionCreateInput,
    options: RequestOptions = {},
  ): Promise<Collection> {
    return transport.requestParsed(Collection, "/api/collection", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a collection, patching only the fields the body carries. */
  async function update(
    ref: CollectionId,
    params: CollectionUpdateInput,
    options: RequestOptions = {},
  ): Promise<Collection> {
    return transport.requestParsed(Collection, `/api/collection/${refPath(ref)}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a collection. Metabase models this as an update, not its own endpoint. */
  async function archive(ref: CollectionId, options: RequestOptions = {}): Promise<Collection> {
    return update(ref, { archived: true }, options);
  }

  /**
   * Walk the items inside a collection one page at a time. This endpoint pages on the server, so
   * the caller consumes pages rather than a single list and decides how far to pull.
   */
  function itemPages(
    ref: CollectionId,
    params: CollectionItemListParams = {},
    options: CollectionItemPageOptions = {},
  ): AsyncIterable<Page<CollectionItem>> {
    return paginatePages(transport, `/api/collection/${refPath(ref)}/items`, CollectionItem, {
      query: {
        models: params.models,
        archived: params.archived,
        pinned_state: params.pinned_state,
      },
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  /** Fetch the collection hierarchy as a forest of nested nodes. */
  async function tree(options: RequestOptions = {}): Promise<ListResult<CollectionTreeNode>> {
    const data = await transport.requestParsed(CollectionTreeApiList, "/api/collection/tree", {
      ...options,
    });
    return { data, total: null };
  }

  return { list, listWithLibrary, get, create, update, archive, itemPages, tree };
}
