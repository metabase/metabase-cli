import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { isFileNotFoundError } from "@metabase/client/errors";

import type {
  GitSyncTreeCollection,
  GitSyncTreeItem,
  GitSyncTreeTransforms,
  SyncedCollection,
  SyncedItem,
  SyncedTransforms,
} from "../../contracts/metabase";

import { contentEntity, isContentYaml } from "./links";

// The CLI's import roots that hold content carrying an entity id. The CLI's own list also names
// `databases`, whose tables and fields have none, so walking it would read every table for nothing.
// Main cannot import the CLI's source, so the list is named again here.
const ENTITY_ROOTS = ["collections", "transforms", "python_libraries"] as const;
const POSIX_SEPARATOR = "/";

type EntityPaths = ReadonlyMap<string, string>;

async function yamlUnder(cwd: string, root: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, root), { recursive: true });
    return entries
      .map((entry) => [root, ...entry.split(sep)].join(POSIX_SEPARATOR))
      .filter(isContentYaml);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

// Each entity id to the checkout's file holding it. Paths are walked in order, so when two files
// claim one id the first by path wins.
export async function entityPaths(cwd: string): Promise<EntityPaths> {
  const index = new Map<string, string>();
  for (const root of ENTITY_ROOTS) {
    const paths = (await yamlUnder(cwd, root)).toSorted();
    for (const path of paths) {
      const entity = contentEntity(await readFile(join(cwd, path), "utf8"));
      if (entity !== null && entity.entityId !== null && !index.has(entity.entityId)) {
        index.set(entity.entityId, path);
      }
    }
  }
  return index;
}

function syncedItem(item: GitSyncTreeItem, paths: EntityPaths): SyncedItem {
  return {
    id: item.id,
    entityId: item.entity_id,
    name: item.name,
    model: item.model,
    path: paths.get(item.entity_id) ?? null,
  };
}

// A collection whose parent is not among the synced ones is a root. The walk goes down from the
// roots, so collections whose parents form a cycle are never reached rather than recursed forever.
export function nestCollections(
  collections: readonly GitSyncTreeCollection[],
  paths: EntityPaths,
): SyncedCollection[] {
  const ids = new Set(collections.map((collection) => collection.id));
  const children = new Map<number | null, GitSyncTreeCollection[]>();
  for (const collection of collections) {
    const parent =
      collection.parent_id !== null && ids.has(collection.parent_id) ? collection.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), collection]);
  }
  const nest = (parent: number | null): SyncedCollection[] =>
    (children.get(parent) ?? []).map((collection) => ({
      id: collection.id,
      entityId: collection.entity_id,
      name: collection.name,
      collections: nest(collection.id),
      items: collection.items.map((item) => syncedItem(item, paths)),
    }));
  return nest(null);
}

export function nestTransforms(
  transforms: GitSyncTreeTransforms,
  paths: EntityPaths,
): SyncedTransforms {
  return {
    collections: nestCollections(transforms.collections, paths),
    items: transforms.items.map((item) => syncedItem(item, paths)),
  };
}
