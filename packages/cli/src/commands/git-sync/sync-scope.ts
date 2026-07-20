import { z } from "zod";

import { errorMessage } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { HttpError } from "../../core/http/errors";
import { Collection } from "../../domain/collection";
import { warn } from "../../output/notice";

import { fetchCollectionsWithLibrary } from "../collection/listing";
import { fetchOptionalParsed } from "./poll-task";

const REMOTE_SYNC_URL_SETTING_PATH = "/api/setting/remote-sync-url";

const RemoteSyncUrl = z.string().nullable();

export const SyncedCollection = Collection.pick({ id: true, name: true }).strip();
export type SyncedCollection = z.infer<typeof SyncedCollection>;

const SyncScopeCollection = Collection.pick({
  id: true,
  name: true,
  is_remote_synced: true,
}).strip();

export async function fetchSyncedCollections(client: Client): Promise<SyncedCollection[]> {
  const collections = await fetchCollectionsWithLibrary(client, SyncScopeCollection);
  return collections
    .filter((collection) => collection.is_remote_synced === true)
    .map((collection) => ({ id: collection.id, name: collection.name }));
}

// The setting is admin-readable only, and unregistered on servers without the remote-sync
// module; both cases mean "no usable remote", not a failure of the caller's command.
export async function fetchRemoteSyncUrlIfReadable(client: Client): Promise<string | null> {
  try {
    const url = await fetchOptionalParsed(client, REMOTE_SYNC_URL_SETTING_PATH, RemoteSyncUrl);
    return url === "" ? null : url;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

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
  client: Client,
  collection: Collection | null,
): Promise<void> {
  if (!isOutsideSyncScope(collection)) {
    return;
  }
  try {
    const remoteSyncUrl = await fetchRemoteSyncUrlIfReadable(client);
    const hint = syncScopeHint(collection, remoteSyncUrl);
    if (hint !== null) {
      warn(hint);
    }
  } catch (error) {
    warn(`Could not check git-sync scope for collection ${collection.id}: ${errorMessage(error)}`);
  }
}
