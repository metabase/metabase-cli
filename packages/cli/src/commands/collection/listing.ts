import { z, type ZodType } from "zod";

import type { Client } from "../../core/http/client";

export const COLLECTIONS_PATH = "/api/collection";

export async function fetchCollectionsWithLibrary<T>(
  client: Client,
  itemSchema: ZodType<T>,
): Promise<T[]> {
  return await client.requestParsed(z.array(itemSchema), COLLECTIONS_PATH, {
    query: { "include-library": true },
  });
}
