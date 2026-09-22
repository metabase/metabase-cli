import { z } from "zod";

import { Collection } from "../domain/collection";
import {
  type Library,
  LibraryCollectionInfo,
  type LibraryListing,
  libraryWireSchema,
  toLibrary,
} from "../domain/library";
import type { TableSelectors } from "../domain/table";
import type { RequestOptions, Transport } from "../http/transport";
import { listCollectionsWithLibrary } from "./collection";

// The trailing slash is part of the route: Metabase mounts the Library API under `/library` and
// registers both the read and the create endpoint at `"/"` within it.
const LIBRARY_ROOT_PATH = "/api/ee/library/";
const PUBLISH_TABLES_PATH = "/api/ee/data-studio/table/publish-tables";
const UNPUBLISH_TABLES_PATH = "/api/ee/data-studio/table/unpublish-tables";

const LIBRARY_DATA_TYPE = "library-data";

const PublishTablesResponse = z.object({ target_collection: Collection.nullable() });

export interface LibraryPublishParams extends TableSelectors {
  collection_id: number;
}

export function libraryResource(transport: Transport) {
  /** Get the Library root and its child collections, or `null` on an instance that has none. */
  async function get(options: RequestOptions = {}): Promise<Library | null> {
    await transport.require("library.get", options);
    const { features } = await transport.server(options);
    const wire = await transport.requestParsed(libraryWireSchema(features), LIBRARY_ROOT_PATH, {
      ...options,
    });
    if (wire === null) {
      return null;
    }
    return toLibrary(wire, await libraryListing(options));
  }

  async function libraryListing(options: RequestOptions): Promise<LibraryListing> {
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
    await transport.require("library.create", options);
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
    await transport.require("library.ensureDataCollectionId", options);
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
    await transport.require("library.publishTables", options);
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
    params: TableSelectors,
    options: RequestOptions = {},
  ): Promise<void> {
    await transport.require("library.unpublishTables", options);
    await transport.requestRaw(UNPUBLISH_TABLES_PATH, {
      ...options,
      method: "POST",
      body: params,
      expectContentType: "binary",
    });
  }

  return { get, create, ensureDataCollectionId, publishTables, unpublishTables };
}
