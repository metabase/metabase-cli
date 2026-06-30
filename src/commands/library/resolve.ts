import { z } from "zod";

import type { Client } from "../../core/http/client";
import { Collection } from "../../domain/collection";
import { Library } from "../../domain/library";

export const LIBRARY_ROOT_PATH = "/api/ee/library/";
const COLLECTION_LIST_PATH = "/api/collection";
const LIBRARY_DATA_TYPE = "library-data";

const AbsentLibrary = z.object({ data: z.null() });
const LibraryOrAbsent = z.union([Library, AbsentLibrary]);

const LibraryCollectionEntry = Collection.pick({ id: true, type: true }).strip();
const LibraryCollections = z.array(LibraryCollectionEntry);
type LibraryChildType = NonNullable<z.infer<typeof LibraryCollectionEntry>["type"]>;

export async function fetchLibrary(client: Client): Promise<Library | null> {
  const result = await client.requestParsed(LibraryOrAbsent, LIBRARY_ROOT_PATH);
  if (!("effective_children" in result)) {
    return null;
  }
  // GET /api/ee/library/ doesn't send each child's `type` in `effective_children` on released
  // servers (v0.59-v0.61) — the frontend's own LibraryChild type omits it too. Resolve the type
  // from the collection list so callers can tell the Data and Metrics collections apart.
  const typeById = await fetchLibraryCollectionTypes(client);
  const effective_children = result.effective_children.map((child) =>
    typeof child.id === "number" ? { ...child, type: typeById.get(child.id) ?? child.type } : child,
  );
  return { ...result, effective_children };
}

async function fetchLibraryCollectionTypes(client: Client): Promise<Map<number, LibraryChildType>> {
  const collections = await client.requestParsed(LibraryCollections, COLLECTION_LIST_PATH, {
    query: { "include-library": true },
  });
  const typeById = new Map<number, LibraryChildType>();
  for (const collection of collections) {
    if (typeof collection.id === "number" && collection.type != null) {
      typeById.set(collection.id, collection.type);
    }
  }
  return typeById;
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
