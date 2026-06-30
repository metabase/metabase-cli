import { z } from "zod";

import type { Client } from "../../core/http/client";
import { Library } from "../../domain/library";

export const LIBRARY_ROOT_PATH = "/api/ee/library/";
const LIBRARY_DATA_TYPE = "library-data";

const AbsentLibrary = z.object({ data: z.null() });
const LibraryOrAbsent = z.union([Library, AbsentLibrary]);

export async function fetchLibrary(client: Client): Promise<Library | null> {
  const result = await client.requestParsed(LibraryOrAbsent, LIBRARY_ROOT_PATH);
  return "effective_children" in result ? result : null;
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
