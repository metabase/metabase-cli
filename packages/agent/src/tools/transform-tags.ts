import type { Client } from "@metabase/cli/client";
import { TransformTag, TransformTagCreateInput } from "@metabase/cli/domain";
import { z } from "zod";

const TAGS_PATH = "/api/transform-tag";

const TransformTagList = z.array(TransformTag);

/**
 * A tag is a label that binds transforms to jobs, so an agent names it; the id is the API's
 * business. Names that do not exist yet are created, which is what makes `tags: ["nightly"]` a
 * parameter rather than a lookup-then-create dance.
 */
export async function resolveTagIds(client: Client, names: readonly string[]): Promise<number[]> {
  if (names.length === 0) {
    return [];
  }
  const existing = await client.requestParsed(TransformTagList, TAGS_PATH);
  const byName = new Map(existing.map((tag) => [tag.name, tag.id]));
  const ids: number[] = [];
  for (const name of names) {
    const found = byName.get(name);
    if (found !== undefined) {
      ids.push(found);
      continue;
    }
    const created = await client.requestParsed(TransformTag, TAGS_PATH, {
      method: "POST",
      body: TransformTagCreateInput.parse({ name }),
    });
    byName.set(created.name, created.id);
    ids.push(created.id);
  }
  return ids;
}
