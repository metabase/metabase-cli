import { z } from "zod";

import {
  Collection,
  type CollectionCreateInput,
  type CollectionId,
  CollectionItem,
  type CollectionItemFilterModel,
  CollectionSummary,
  type CollectionListFilter,
  type CollectionNamespace,
  type CollectionPinnedState,
  CollectionTreeNode,
  type CollectionUpdateInput,
} from "../domain/collection";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";
import type { FeatureName } from "../version/features";
import { explainer, type ParameterRequirement } from "../version/refusal";

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

// Metabase leaves the Library collections out of the list unless asked.
const INCLUDE_LIBRARY = { "include-library": true } as const;

const TRASH_ALIAS = "trash";

export interface CollectionListParams {
  filter?: CollectionListFilter | undefined;
  namespace?: CollectionNamespace | undefined;
}

export interface CollectionSummaryParams {
  /** List the archived collections instead of the live ones. */
  archived?: boolean | undefined;
}

export interface CollectionItemListParams {
  models?: CollectionItemFilterModel[] | undefined;
  archived?: boolean | undefined;
  pinned_state?: CollectionPinnedState | undefined;
}

export interface CollectionTreeParams {
  /** Include the Library collections, which the tree leaves out by default. */
  "include-library"?: boolean | undefined;
}

// The walk's own settings, minus the query the method builds from `CollectionItemListParams`.
export type CollectionItemPageOptions = Omit<PaginateOptions, "query">;

const MODELS_FIELDS = ["models"];

// A server older than one of these filter values answers 400 naming `models`.
const ITEM_MODEL_FEATURES: Partial<Record<CollectionItemFilterModel, FeatureName>> = {
  transform: "transforms",
  measure: "collectionItemMeasures",
  exploration: "explorations",
};

function itemModelFeatures(
  _ref: CollectionId,
  params: CollectionItemListParams = {},
): ParameterRequirement[] {
  if (params.models === undefined) {
    return [];
  }
  return params.models.flatMap((model) => {
    const feature = ITEM_MODEL_FEATURES[model];
    return feature === undefined ? [] : [{ feature, fields: MODELS_FIELDS }];
  });
}

// A collection is reachable by numeric id, by 21-character entity id, and by the aliases `root`
// and `trash`, so every ref reaches the path through `encodeURIComponent`.
function refPath(ref: CollectionId): string {
  return encodeURIComponent(ref);
}

/**
 * List every collection the caller can read, the Library and its children among them, parsing each
 * through the caller's own projection. `Collection` pins `type`, `namespace` and `authority_level`
 * to closed enums, so a consumer reading a few fields off every collection on the instance narrows
 * here: one collection carrying a server value outside those sets then costs nothing to a caller
 * that never reads the field.
 */
export async function listCollectionsAs<T>(
  transport: Transport,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T[]> {
  return transport.requestParsed(z.array(schema), "/api/collection", {
    ...options,
    query: INCLUDE_LIBRARY,
  });
}

export function collectionResource(transport: Transport) {
  const { explainWalk } = explainer(transport, "collection");

  /**
   * List collections. `filter` picks a server-side preset: everything, archived, or personal. Every
   * preset includes the Library collections that match it. `namespace` lists that namespace's
   * collections, with its root, instead of the default namespace's.
   */
  async function list(
    params: CollectionListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Collection>> {
    const data = await transport.requestParsed(CollectionApiList, "/api/collection", {
      ...options,
      query: {
        ...COLLECTION_LIST_QUERY[params.filter ?? DEFAULT_LIST_FILTER],
        ...INCLUDE_LIBRARY,
        namespace: params.namespace,
      },
    });
    return { data, total: null };
  }

  /**
   * List the collections the caller can read, the Library and its children among them, as
   * `CollectionSummary`, which reads no enum, so a collection of a type or namespace this client
   * does not know fails nothing. `archived` lists the archived collections instead of the live
   * ones, which also leaves out the root collection.
   */
  async function summaries(
    params: CollectionSummaryParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<CollectionSummary>> {
    const data = await transport.requestParsed(z.array(CollectionSummary), "/api/collection", {
      ...options,
      query: { archived: params.archived, ...INCLUDE_LIBRARY },
    });
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

  /**
   * Update a collection, patching the fields the body carries. The server reads an absent
   * `archived` as `false`, so a patch without it restores an archived collection, and a patch that
   * moves a collection into the trash ignores `parent_id`.
   */
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
   * the caller consumes pages rather than a single list and decides how far to pull. The `trash`
   * alias costs one more request, which reads the trash collection's id. A `models` filter takes
   * `transform` only with `transforms`, `measure` only with `collectionItemMeasures`, and
   * `exploration` only with `explorations`.
   */
  async function* itemPages(
    ref: CollectionId,
    params: CollectionItemListParams = {},
    options: CollectionItemPageOptions = {},
  ): AsyncIterable<Page<CollectionItem>> {
    const withSignal = options.signal !== undefined && { signal: options.signal };
    // Every server answers the trash collection at `GET /api/collection/trash`, but none routes
    // the alias through `/:id/items`, whose id is an integer or an entity id.
    const itemsRef = ref === TRASH_ALIAS ? (await get(TRASH_ALIAS, { ...withSignal })).id : ref;
    yield* paginatePages(transport, `/api/collection/${refPath(itemsRef)}/items`, CollectionItem, {
      query: {
        models: params.models,
        archived: params.archived,
        // 58 through 63 read `pinned_state` and 64 on `pinned-state`; each drops the other unread.
        pinned_state: params.pinned_state,
        "pinned-state": params.pinned_state,
      },
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...withSignal,
    });
  }

  /** Fetch the collection hierarchy as a forest of nested nodes. */
  async function tree(
    params: CollectionTreeParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<CollectionTreeNode>> {
    const data = await transport.requestParsed(CollectionTreeApiList, "/api/collection/tree", {
      ...options,
      query: { "include-library": params["include-library"] },
    });
    return { data, total: null };
  }

  return {
    list,
    summaries,
    get,
    create,
    update,
    archive,
    itemPages: explainWalk("itemPages", itemPages, itemModelFeatures),
    tree,
  };
}
