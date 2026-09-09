import type { MetabaseClient } from "@metabase/client/client";

import type { WorktreeScope } from "../../core/worktree-scope";
import { assertInWorktree } from "../worktree-scope";

const TRANSFORM_TAG_KIND = "transform tag";

// Tags have no get-by-id endpoint, so the scope's own listing is what says whether a tag is in it.
export async function assertTagInWorktree(
  client: MetabaseClient,
  id: number,
  scope: WorktreeScope | null,
): Promise<void> {
  if (scope === null) {
    return;
  }
  const { data } = await client.transformTag.list({ "worktree-id": scope.id });
  const match = data.find((tag) => tag.id === id);
  assertInWorktree(TRANSFORM_TAG_KIND, id, match === undefined ? null : match.worktree_id, scope);
}
