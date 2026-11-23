import { z } from "zod";

import type { Features } from "../version/features";

export const SyncTaskStatus = z.enum([
  "running",
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
]);
export type SyncTaskStatus = z.infer<typeof SyncTaskStatus>;

export const SyncTaskType = z.enum(["import", "export"]);
export type SyncTaskType = z.infer<typeof SyncTaskType>;

/**
 * The direction an instance syncs in: `read-only` follows the remote branch and refuses local edits
 * to synced content; `read-write` also exports its own changes.
 */
export const SyncType = z.enum(["read-only", "read-write"]);
export type SyncType = z.infer<typeof SyncType>;

/**
 * Whether a remote is configured, the direction the instance syncs in, and the branch it tracks,
 * `null` when none is set. The sync type is a `SyncType` when an admin sets it; a server that reads
 * `MB_REMOTE_SYNC_TYPE` (60 and later) does not check that value, so it is the string the server
 * holds.
 */
export const RemoteSyncState = z.object({
  configured: z.boolean(),
  sync_type: z.string(),
  branch: z.string().nullable(),
});
export type RemoteSyncState = z.infer<typeof RemoteSyncState>;

const TERMINAL_STATUSES = new Set<SyncTaskStatus>([
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
]);

const FAILED_STATUSES = new Set<SyncTaskStatus>(["errored", "timed-out", "conflict"]);

/** Whether the server will report any further progress for a task in this status. */
export function isSyncTaskTerminal(status: SyncTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Whether a terminal status means the sync did not carry out what it was asked to. */
export function isSyncTaskFailed(status: SyncTaskStatus): boolean {
  return FAILED_STATUSES.has(status);
}

// The branch an outcome names: the task's own, or on a server that reads it from the setting when
// the task ends, the tracked branch then, `null` when none was set.
const SyncOutcomeBranch = z.string().nullable();

const SyncPulled = z.object({
  kind: z.literal("pulled"),
  count: z.number().int(),
  branch: SyncOutcomeBranch,
});
const SyncPushed = z.object({
  kind: z.literal("pushed"),
  count: z.number().int(),
  branch: SyncOutcomeBranch,
});
const SyncMerged = z.object({
  kind: z.literal("merged"),
  pulled: z.number().int(),
  pushed: z.number().int(),
  branch: SyncOutcomeBranch,
});
const SyncPullSkipped = z.object({ kind: z.literal("pull-skipped") });
const SyncPushSkipped = z.object({ kind: z.literal("push-skipped") });
const SyncRemoteChanged = z.object({ kind: z.literal("remote-changed") });
const SyncHistoryRewritten = z.object({ kind: z.literal("history-rewritten") });

/**
 * What a sync task did: `pulled` or `pushed` so many entities to a branch, `merged` both ways, found
 * nothing to pull or push (`pull-skipped`, `push-skipped`), or, ending an export in `conflict`,
 * found the remote moved on (`remote-changed`) or its history rewritten (`history-rewritten`).
 */
export const SyncTaskOutcome = z.discriminatedUnion("kind", [
  SyncPulled,
  SyncPushed,
  SyncMerged,
  SyncPullSkipped,
  SyncPushSkipped,
  SyncRemoteChanged,
  SyncHistoryRewritten,
]);
export type SyncTaskOutcome = z.infer<typeof SyncTaskOutcome>;

export const SyncTaskInitiator = z.object({
  id: z.number().int().positive(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string(),
});
export type SyncTaskInitiator = z.infer<typeof SyncTaskInitiator>;

// `outcome` is `null` while the task runs, when it failed, and on a server without
// `remoteSyncTaskOutcome`, which records none. `initiated_by_user` is the user who started the task,
// and `last_heartbeat_at` when the process running it last said it was alive; both are `null` when
// there is none, and on a server without `remoteSyncTaskHeartbeat`, which reports neither.
export const SyncTask = z
  .object({
    id: z.number().int().positive(),
    sync_task_type: SyncTaskType,
    status: SyncTaskStatus,
    progress: z.number().min(0).max(1).nullable(),
    started_at: z.string(),
    ended_at: z.string().nullable().optional(),
    last_progress_report_at: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    initiated_by: z.number().int().positive().nullable().optional(),
    cancelled: z.boolean().nullable().optional(),
    error_message: z.string().nullable().optional(),
    conflicts: z.array(z.string()).nullable().optional(),
    outcome: SyncTaskOutcome.nullable(),
    initiated_by_user: SyncTaskInitiator.nullable(),
    last_heartbeat_at: z.string().nullable(),
  })
  .loose();
export type SyncTask = z.infer<typeof SyncTask>;

const SyncTaskWireV64 = SyncTask.omit({ initiated_by_user: true, last_heartbeat_at: true });

function fromTaskWireV64(wire: z.infer<typeof SyncTaskWireV64>): SyncTask {
  return { ...wire, initiated_by_user: null, last_heartbeat_at: null };
}

const SyncTaskWireV62 = SyncTaskWireV64.omit({ outcome: true });

function fromTaskWireV62(wire: z.infer<typeof SyncTaskWireV62>): SyncTask {
  return { ...wire, outcome: null, initiated_by_user: null, last_heartbeat_at: null };
}

/** A sync task as a server with `features` answers it, read as `SyncTask`. */
export function syncTaskSchema(features: Features): z.ZodType<SyncTask> {
  if (features.remoteSyncTaskHeartbeat) {
    return SyncTask;
  }
  if (features.remoteSyncTaskOutcome) {
    return SyncTaskWireV64.transform(fromTaskWireV64);
  }
  return SyncTaskWireV62.transform(fromTaskWireV62);
}

export const SyncTaskCompact = SyncTask.pick({
  id: true,
  sync_task_type: true,
  status: true,
  progress: true,
  version: true,
  error_message: true,
  conflicts: true,
}).strip();
export type SyncTaskCompact = z.infer<typeof SyncTaskCompact>;

const SyncCollectionAncestor = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.string().nullable(),
  personal_owner_id: z.number().int().positive().nullable(),
});
type SyncCollectionAncestor = z.infer<typeof SyncCollectionAncestor>;

/** A collection a changed item belongs to, with the ancestors the caller can read, root-most first. */
export const SyncItemCollection = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: z.string().nullable(),
  effective_ancestors: z.array(SyncCollectionAncestor),
});
export type SyncItemCollection = z.infer<typeof SyncItemCollection>;

// `collection_id` is the collection the item sits in, or a collection's own id, `null` when there is
// none or the caller cannot read it. `collection` is the same collection in full, `null` likewise and
// on a server with `remoteSyncDirtyItemsByCollectionId`, which names it by id alone. `model_id` is
// the model an action belongs to, `null` for an action without one, for any other item, and on a
// server that does not say: every one before Metabase 65.
export const SyncDirtyItem = z
  .object({
    id: z.number().int(),
    name: z.string().nullable(),
    model: z.string(),
    sync_status: z.string(),
    collection_id: z.number().int().positive().nullable(),
    collection: SyncItemCollection.nullable(),
    model_id: z.number().int().positive().nullable(),
    description: z.string().nullable().optional(),
    display: z.string().nullable().optional(),
    query_type: z.string().nullable().optional(),
    table_id: z.number().int().positive().nullable().optional(),
    table_name: z.string().nullable().optional(),
  })
  .loose();
export type SyncDirtyItem = z.infer<typeof SyncDirtyItem>;

// Metabase 65 names an action's model as `card_id`, and leaves the key out of any other item; the
// servers before it send no such key.
const SyncDirtyItemWireV65 = SyncDirtyItem.omit({ collection: true, model_id: true }).extend({
  card_id: z.number().int().positive().nullable().optional(),
});

function fromDirtyItemWireV65(wire: z.infer<typeof SyncDirtyItemWireV65>): SyncDirtyItem {
  const { card_id, ...item } = wire;
  return { ...item, collection: null, model_id: card_id ?? null };
}

// From Metabase 66 an item is its `id` and `model` and `data`, the row with what the server hydrates
// of it: its collection with that collection's ancestors, found where its model holds it (a segment
// sits in its table's collection). The root collection is hydrated as an object with the id
// `"root"`, which is no collection the item names, and leads every ancestor list it is shown in.
const RootCollectionV66 = z.object({ id: z.literal("root") });

const SyncItemCollectionV66 = SyncItemCollection.extend({
  effective_ancestors: z.array(z.union([RootCollectionV66, SyncCollectionAncestor])),
});

const CollectionOrRootV66 = z
  .union([RootCollectionV66, SyncItemCollectionV66])
  .nullable()
  .optional();

const InCollectionV66 = z.object({ collection: CollectionOrRootV66 }).nullable().optional();

const NamedInCollectionV66 = z
  .object({
    name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    collection: CollectionOrRootV66,
  })
  .nullable()
  .optional();

// The fields of a row that name it or lead to its collection. A model's row carries only those of
// its own; every other key is left unread.
const SyncRowV66 = z.object({
  name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  term: z.string().optional(),
  path: z.string().optional(),
  slug: z.string().optional(),
  type: z.string().nullable().optional(),
  effective_ancestors: SyncItemCollectionV66.shape.effective_ancestors.optional(),
  collection: CollectionOrRootV66,
  model_id: z.number().int().positive().nullable().optional(),
  model: InCollectionV66,
  action: z
    .object({ model: InCollectionV66, collection: CollectionOrRootV66 })
    .nullable()
    .optional(),
  card: InCollectionV66,
  transform: InCollectionV66,
  table: NamedInCollectionV66,
  field: z
    .object({
      name: z.string().nullable().optional(),
      display_name: z.string().nullable().optional(),
      table: NamedInCollectionV66,
    })
    .nullable()
    .optional(),
});
type SyncRowV66 = z.infer<typeof SyncRowV66>;
type CollectionOrRootV66 = z.infer<typeof CollectionOrRootV66>;

function rowCollectionV66(model: string, id: number, row: SyncRowV66): CollectionOrRootV66 {
  if (model === "collection") {
    return row.name === undefined || row.name === null || row.type === undefined
      ? null
      : { id, name: row.name, type: row.type, effective_ancestors: row.effective_ancestors ?? [] };
  }
  if (model === "action") {
    return row.model?.collection ?? row.collection;
  }
  if (model === "actiontest") {
    return row.action?.model?.collection ?? row.action?.collection;
  }
  if (model === "cardtest") {
    return row.card?.collection;
  }
  if (model === "transformtest") {
    return row.transform?.collection;
  }
  if (model === "segment" || model === "measure") {
    return row.table?.collection;
  }
  if (model === "fieldusersettings" || model === "dimension") {
    return row.field?.table?.collection;
  }
  return row.collection;
}

function collectionFromV66(collection: CollectionOrRootV66): SyncItemCollection | null {
  if (collection === undefined || collection === null || collection.id === "root") {
    return null;
  }
  const ancestors = collection.effective_ancestors.filter(isCollectionAncestor);
  return { ...collection, effective_ancestors: ancestors };
}

function isCollectionAncestor(
  ancestor: z.infer<typeof RootCollectionV66> | SyncCollectionAncestor,
): ancestor is SyncCollectionAncestor {
  return typeof ancestor.id === "number";
}

// The name the server's own client shows a row by.
function rowNameV66(model: string, row: SyncRowV66): string | null {
  if (model === "glossary") {
    return row.term ?? null;
  }
  if (model === "pythonlibrary") {
    return row.path ?? null;
  }
  if (model === "dataapp") {
    return row.name ?? row.slug ?? null;
  }
  if (model === "tableusersettings") {
    return row.display_name ?? row.table?.display_name ?? row.table?.name ?? null;
  }
  if (model === "fieldusersettings") {
    return row.display_name ?? row.field?.display_name ?? row.field?.name ?? null;
  }
  return row.name ?? null;
}

// What a v66 item says of where it sits: `data` is `null` for a row that no longer exists.
interface ItemPlacement {
  collection_id: number | null;
  collection: SyncItemCollection | null;
  model_id: number | null;
}

function placementV66(model: string, id: number, row: SyncRowV66 | null): ItemPlacement {
  if (row === null) {
    return { collection_id: null, collection: null, model_id: null };
  }
  const collection = collectionFromV66(rowCollectionV66(model, id, row));
  return {
    collection_id: collection === null ? null : collection.id,
    collection,
    model_id: model === "action" ? (row.model_id ?? null) : null,
  };
}

const SyncDirtyItemWireV66 = z.object({
  id: z.number().int(),
  model: z.string(),
  name: z.string().nullable(),
  sync_status: z.string(),
  data: SyncRowV66.nullable(),
});

function fromDirtyItemWireV66(wire: z.infer<typeof SyncDirtyItemWireV66>): SyncDirtyItem {
  const { data, ...item } = wire;
  return { ...item, ...placementV66(item.model, item.id, data) };
}

/** A changed item as a server with `features` lists it, read as `SyncDirtyItem`. */
export function syncDirtyItemSchema(features: Features): z.ZodType<SyncDirtyItem> {
  return features.remoteSyncDirtyItemsByCollectionId
    ? SyncDirtyItemWireV65.transform(fromDirtyItemWireV65)
    : SyncDirtyItemWireV66.transform(fromDirtyItemWireV66);
}

// `name` is what the server's own client shows the row by, `null` when its row names it nothing.
const SyncEntityRef = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  model: z.string(),
});
type SyncEntityRef = z.infer<typeof SyncEntityRef>;

/**
 * Content the synced collections use that is not synced itself, with what uses it. `collection` is
 * where it sits, `null` when that is the root collection or no collection the caller can read.
 */
export const SyncUnsyncedDependency = SyncEntityRef.extend({
  used_by: z.array(SyncEntityRef),
  collection: SyncItemCollection.nullable(),
});
export type SyncUnsyncedDependency = z.infer<typeof SyncUnsyncedDependency>;

const SyncItemWireV66 = z.object({
  id: z.number().int(),
  model: z.string(),
  data: SyncRowV66,
});

const SyncUnsyncedDependencyWire = SyncItemWireV66.extend({
  used_by: z.array(SyncItemWireV66),
});

function entityRefFromV66(wire: z.infer<typeof SyncItemWireV66>): SyncEntityRef {
  return { id: wire.id, model: wire.model, name: rowNameV66(wire.model, wire.data) };
}

/** An unsynced dependency as a settings refusal lists it, read as `SyncUnsyncedDependency`. */
export const syncUnsyncedDependencySchema: z.ZodType<SyncUnsyncedDependency> =
  SyncUnsyncedDependencyWire.transform((wire) => ({
    ...entityRefFromV66(wire),
    used_by: wire.used_by.map(entityRefFromV66),
    collection: collectionFromV66(rowCollectionV66(wire.model, wire.id, wire.data)),
  }));

// `dirty_objects` is `null` on a server without `remoteSyncImportNamesDirtyObjects`, which names
// none.
export const SyncDirtyRefusal = z.object({
  kind: z.literal("dirty"),
  dirty_objects: z.array(SyncDirtyItem).nullable(),
});
export type SyncDirtyRefusal = z.infer<typeof SyncDirtyRefusal>;

export const SyncUnsyncedDependenciesRefusal = z.object({
  kind: z.literal("unsynced-dependencies"),
  unsynced_dependencies: z.array(SyncUnsyncedDependency),
});
export type SyncUnsyncedDependenciesRefusal = z.infer<typeof SyncUnsyncedDependenciesRefusal>;

// `current_branch` is the branch tracked now, `null` when none is.
export const SyncBranchMismatchRefusal = z.object({
  kind: z.literal("branch-mismatch"),
  current_branch: z.string().nullable(),
});
export type SyncBranchMismatchRefusal = z.infer<typeof SyncBranchMismatchRefusal>;

/**
 * What a git-sync refusal named: an import refused on changes not yet pushed (`dirty`), a settings
 * update refused on content the synced collections use but which is not synced
 * (`unsynced-dependencies`), or a call naming a branch other than the tracked one
 * (`branch-mismatch`).
 */
export const SyncRefusal = z.discriminatedUnion("kind", [
  SyncDirtyRefusal,
  SyncUnsyncedDependenciesRefusal,
  SyncBranchMismatchRefusal,
]);
export type SyncRefusal = z.infer<typeof SyncRefusal>;

export const SyncDirtyItemCompact = SyncDirtyItem.pick({
  id: true,
  name: true,
  model: true,
  sync_status: true,
  collection_id: true,
}).strip();
export type SyncDirtyItemCompact = z.infer<typeof SyncDirtyItemCompact>;

// `cached` is whether the answer came from the server's cache of the comparison rather than from
// the remote. `branch_missing` is present, and true, when the tracked branch is gone from the
// remote; `has_changes` is then false and `remote_version` null.
export const SyncRemoteChanges = z.object({
  has_changes: z.boolean(),
  remote_version: z.string().nullable(),
  local_version: z.string().nullable(),
  cached: z.boolean(),
  branch_missing: z.boolean().optional(),
});
export type SyncRemoteChanges = z.infer<typeof SyncRemoteChanges>;

const SyncRemoteChangesWireV66 = SyncRemoteChanges.omit({ cached: true });

// A server without the cache reads the remote on every call, so none of its answers is cached.
function fromRemoteChangesWireV66(
  wire: z.infer<typeof SyncRemoteChangesWireV66>,
): SyncRemoteChanges {
  return { ...wire, cached: false };
}

/** `GET /api/ee/remote-sync/has-remote-changes` on a server with `features`, as `SyncRemoteChanges`. */
export function syncRemoteChangesSchema(features: Features): z.ZodType<SyncRemoteChanges> {
  return features.remoteSyncChangesCache
    ? SyncRemoteChanges
    : SyncRemoteChangesWireV66.transform(fromRemoteChangesWireV66);
}

export const SyncMergeSummary = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
});
export type SyncMergeSummary = z.infer<typeof SyncMergeSummary>;

export const SyncForcePushCasualties = z.object({
  deleted: z.array(z.string()),
  overwritten: z.array(z.string()),
});
export type SyncForcePushCasualties = z.infer<typeof SyncForcePushCasualties>;

export const SyncExportPreflight = z
  .object({
    has_changes: z.boolean(),
    clean: z.boolean(),
    conflicts: z.array(z.string()),
    summary: SyncMergeSummary,
    force_push_casualties: SyncForcePushCasualties,
    reason: z.literal("history-rewritten").nullable(),
  })
  .loose();
export type SyncExportPreflight = z.infer<typeof SyncExportPreflight>;

export const SyncExportPreflightCompact = SyncExportPreflight.pick({
  has_changes: true,
  clean: true,
  conflicts: true,
  summary: true,
  force_push_casualties: true,
  reason: true,
}).strip();
export type SyncExportPreflightCompact = z.infer<typeof SyncExportPreflightCompact>;

export const SyncBranchCreated = z.object({
  status: z.literal("success"),
  message: z.string(),
});
export type SyncBranchCreated = z.infer<typeof SyncBranchCreated>;

export const SyncConnectionTested = z.object({ status: z.literal("success") });
export type SyncConnectionTested = z.infer<typeof SyncConnectionTested>;

export const SyncSettingsUpdateResult = z.object({
  success: z.boolean(),
  task_id: z.number().int().positive().optional(),
});
export type SyncSettingsUpdateResult = z.infer<typeof SyncSettingsUpdateResult>;

// `final` is present only when the caller asked to wait, and null when the server had already
// forgotten the task by the time the poll ran.
export const SyncImportResult = z.object({
  message: z.string().nullable(),
  task_id: z.number().int().positive().nullable(),
  final: SyncTask.nullable().optional(),
});
export type SyncImportResult = z.infer<typeof SyncImportResult>;

// `branch` is the branch the export targets, null where the request named none and a server without
// the branch guard exports to the one it tracks.
export const SyncExportResult = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
  branch: z.string().nullable(),
  final: SyncTask.nullable().optional(),
});
export type SyncExportResult = z.infer<typeof SyncExportResult>;

export const SyncStashResult = z.object({
  status: z.literal("success"),
  message: z.string(),
  task_id: z.number().int().positive(),
  final: SyncTask.nullable().optional(),
});
export type SyncStashResult = z.infer<typeof SyncStashResult>;
