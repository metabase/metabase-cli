import { z } from "zod";

import type { Client } from "../../core/http/client";
import { Collection } from "../../domain/collection";
import { Library } from "../../domain/library";

import { fetchCollectionsWithLibrary } from "../collection/listing";

export const LIBRARY_ROOT_PATH = "/api/ee/library/";
const LIBRARY_DATA_TYPE = "library-data";

const AbsentLibrary = z.object({ data: z.null() });
const LibraryOrAbsent = z.union([Library, AbsentLibrary]);

const LibraryCollectionEntry = Collection.pick({
  id: true,
  type: true,
  is_remote_synced: true,
}).strip();
type LibraryCollectionInfo = z.infer<typeof LibraryCollectionEntry>;

export async function fetchLibrary(client: Client): Promise<Library | null> {
  const result = await client.requestParsed(LibraryOrAbsent, LIBRARY_ROOT_PATH);
  if (!("effective_children" in result)) {
    return null;
  }
  // GET /api/ee/library/ doesn't send each child's `type` or `is_remote_synced` in
  // `effective_children` on released servers (v0.59-v0.61) — the frontend's own LibraryChild
  // type omits them too. Resolve both from the collection list so callers can tell the Data
  // and Metrics collections apart and see whether each is in the git-sync scope.
  const infoById = await fetchLibraryCollectionInfo(client);
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

async function fetchLibraryCollectionInfo(
  client: Client,
): Promise<Map<number, LibraryCollectionInfo>> {
  const collections = await fetchCollectionsWithLibrary(client, LibraryCollectionEntry);
  const infoById = new Map<number, LibraryCollectionInfo>();
  for (const collection of collections) {
    if (typeof collection.id === "number") {
      infoById.set(collection.id, collection);
    }
  }
  return infoById;
}

export async function createLibrary(client: Client): Promise<Library> {
  const existing = await fetchLibrary(client);
  if (existing !== null) {
    return existing;
  }
  await client.requestRaw(LIBRARY_ROOT_PATH, { method: "POST" });
  const created = await fetchLibrary(client);
  if (created === null) {
    throw new Error(`Library was not created after POST ${LIBRARY_ROOT_PATH}`);
  }
  return created;
}

export async function ensureLibraryDataCollectionId(client: Client): Promise<number> {
  const library = await createLibrary(client);
  const data = library.effective_children.find((child) => child.type === LIBRARY_DATA_TYPE);
  if (data === undefined) {
    throw new Error("Library has no Data collection to publish into");
  }
  if (typeof data.id !== "number") {
    throw new Error(`Library Data collection has a non-numeric id ${String(data.id)}`);
  }
  return data.id;
}
