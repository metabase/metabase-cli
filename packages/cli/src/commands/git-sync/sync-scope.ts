import type { MetabaseClient } from "@metabase/client/client";
import { Collection } from "@metabase/client/domain/collection";
import { errorMessage } from "@metabase/client/errors";

import { warn } from "../../output/notice";

function isOutsideSyncScope(collection: Collection | null): collection is Collection {
  return collection !== null && collection.is_remote_synced === false;
}

export function syncScopeHint(
  collection: Collection | null,
  remoteSyncUrl: string | null,
): string | null {
  if (!isOutsideSyncScope(collection) || remoteSyncUrl === null) {
    return null;
  }
  return (
    `Note: collection ${collection.id} "${collection.name}" is not marked for git-sync, ` +
    `so \`mb git-sync export\` will not carry it (or its published tables' metadata) to ${remoteSyncUrl}. ` +
    `Add it with: mb git-sync add-collection ${collection.id}`
  );
}

// Advisory only: the command's mutation has already succeeded by the time this runs, so a
// failed scope lookup is reported on stderr instead of failing the command.
export async function warnIfOutsideSyncScope(
  mb: MetabaseClient,
  collection: Collection | null,
): Promise<void> {
  if (!isOutsideSyncScope(collection)) {
    return;
  }
  try {
    const hint = syncScopeHint(collection, await mb.gitSync.remoteUrl());
    if (hint !== null) {
      warn(hint);
    }
  } catch (error) {
    warn(`Could not check git-sync scope for collection ${collection.id}: ${errorMessage(error)}`);
  }
}
