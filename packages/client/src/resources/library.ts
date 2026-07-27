import { z } from "zod";

import { Collection } from "../domain/collection";
import { Library } from "../domain/library";
import type { RequestOptions, Transport } from "../http/transport";
import { listCollectionsWithLibrary } from "./collection";

// The trailing slash is part of the route: Metabase mounts the Library API under `/library` and
// registers both the read and the create endpoint at `"/"` within it.
const LIBRARY_ROOT_PATH = "/api/ee/library/";
const PUBLISH_TABLES_PATH = "/api/ee/data-studio/table/publish-tables";
const UNPUBLISH_TABLES_PATH = "/api/ee/data-studio/table/unpublish-tables";

const LIBRARY_DATA_TYPE = "library-data";

// An instance with no Library answers the root with `{ data: null }` rather than a 404.
const AbsentLibrary = z.object({ data: z.null() });
const LibraryOrAbsent = z.union([Library, AbsentLibrary]);

const PublishTablesResponse = z.object({ target_collection: Collection.nullable() });

// Hydrating the Library's children means reading every collection on the instance, so they arrive
// through a projection: a collection whose `namespace` or `authority_level` carries a value outside
// `Collection`'s pinned enums is unrelated to the Library and must not decide whether it resolves.
const LibraryCollectionInfo = Collection.pick({
  id: true,
  type: true,
  is_remote_synced: true,
}).strip();
type LibraryCollectionInfo = z.infer<typeof LibraryCollectionInfo>;

export interface LibraryTableSelectors {
  table_ids?: number[] | undefined;
  database_ids?: number[] | undefined;
  schema_ids?: string[] | undefined;
}

export interface LibraryPublishParams extends LibraryTableSelectors {
  collection_id: number;
}

export function libraryResource(transport: Transport) {
  /** Get the Library root and its child collections, or `null` on an instance that has none. */
  async function get(options: RequestOptions = {}): Promise<Library | null> {
    const result = await transport.requestParsed(LibraryOrAbsent, LIBRARY_ROOT_PATH, {
      ...options,
    });
    if (!("effective_children" in result)) {
      return null;
    }
    // GET /api/ee/library/ doesn't send each child's `type` or `is_remote_synced` in
    // `effective_children` on released servers (v0.59-v0.61) — the frontend's own LibraryChild
    // type omits them too. Resolve both from the collection list so callers can tell the Data
    // and Metrics collections apart and see whether each is in the git-sync scope.
    const infoById = await libraryCollectionsById(options);
    const effective_children = result.effective_children.map((child) => {
      if (typeof child.id !== "number") {
        return child;
      }
      const info = infoById.get(child.id);
      if (info === undefined) {
        return child;
      }
      return {
        ...child,
        type: info.type ?? child.type,
        is_remote_synced: info.is_remote_synced ?? child.is_remote_synced,
      };
    });
    return { ...result, effective_children };
  }

  async function libraryCollectionsById(
    options: RequestOptions,
  ): Promise<Map<number, LibraryCollectionInfo>> {
    const data = await listCollectionsWithLibrary(transport, LibraryCollectionInfo, options);
    const byId = new Map<number, LibraryCollectionInfo>();
    for (const collection of data) {
      if (typeof collection.id === "number") {
        byId.set(collection.id, collection);
      }
    }
    return byId;
  }

  /**
   * Create the Library subtree (its Data and Metrics collections). Metabase takes no body, rejects
   * a second create with a 400, and answers the bare root collection without its
   * `effective_children` — so an existing Library short-circuits the call and a fresh one comes
   * back from a refetch, which together make this idempotent.
   */
  async function create(options: RequestOptions = {}): Promise<Library> {
    const existing = await get(options);
    if (existing !== null) {
      return existing;
    }
    await transport.requestRaw(LIBRARY_ROOT_PATH, { ...options, method: "POST" });
    const created = await get(options);
    if (created === null) {
      throw new Error(`Library was not created after POST ${LIBRARY_ROOT_PATH}`);
    }
    return created;
  }

  /** The id of the Library's Data collection, creating the Library first when it does not exist. */
  async function ensureDataCollectionId(options: RequestOptions = {}): Promise<number> {
    const library = await create(options);
    const data = library.effective_children.find((child) => child.type === LIBRARY_DATA_TYPE);
    if (data === undefined) {
      throw new Error("Library has no Data collection to publish into");
    }
    if (typeof data.id !== "number") {
      throw new Error(`Library Data collection has a non-numeric id ${String(data.id)}`);
    }
    return data.id;
  }

  /**
   * Publish tables — and every upstream table they depend on — into a collection, so they lead the
   * data pickers and rank up in search. Answers the collection they landed in.
   */
  async function publishTables(
    params: LibraryPublishParams,
    options: RequestOptions = {},
  ): Promise<Collection | null> {
    const response = await transport.requestParsed(PublishTablesResponse, PUBLISH_TABLES_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
    return response.target_collection;
  }

  /**
   * Clear the Library collection from tables, and recursively from every downstream table that
   * depends on them. The endpoint answers no JSON body.
   */
  async function unpublishTables(
    params: LibraryTableSelectors,
    options: RequestOptions = {},
  ): Promise<void> {
    await transport.requestRaw(UNPUBLISH_TABLES_PATH, {
      ...options,
      method: "POST",
      body: params,
      expectContentType: "binary",
    });
  }

  return { get, create, ensureDataCollectionId, publishTables, unpublishTables };
}
