import { z } from "zod";

import { Collection } from "../domain/collection";
import {
  isSyncTaskTerminal,
  SyncBranchCreated,
  SyncDirtyItem,
  SyncExportPreflight,
  type SyncExportResult,
  type SyncImportResult,
  SyncRemoteChanges,
  SyncSettingsUpdateResult,
  type SyncStashResult,
  SyncTask,
  type SyncTree,
  type SyncTreeCollection,
  SyncTreeItem,
} from "../domain/git-sync";
import { Worktree } from "../domain/worktree";
import { chainRequestFailure, HttpError } from "../http/errors";
import type { QueryValue, RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type PollOptions, pollUntil } from "../poll";
import type { Features } from "../version/features";

import { listCollectionsWithLibrary, walkCollectionItems } from "./collection";
import { fetchOptionalParsed } from "./optional-parsed";

// The sync scope is decided from three fields of every collection on the instance, so it reads them
// through a projection: a collection whose `type`, `namespace` or `authority_level` carries a value
// outside `Collection`'s pinned enums is still one this answer has to account for.
export const SyncScopeCollection = Collection.pick({
  id: true,
  name: true,
  is_remote_synced: true,
}).strip();
export type SyncScopeCollection = z.infer<typeof SyncScopeCollection>;

// The tree reads every collection on the instance for the flag alone, and a synced one for what the
// tree carries, which every synced collection has: a numeric id, an entity id and a location.
const SyncTreeCollectionRow = z.object({
  id: z.number().int(),
  entity_id: z.string(),
  name: z.string(),
  location: z.string(),
  is_remote_synced: z.literal(true),
});
type SyncTreeCollectionRow = z.infer<typeof SyncTreeCollectionRow>;

const SyncTreeScopeRow = z.union([
  SyncTreeCollectionRow,
  z.object({ is_remote_synced: z.literal(false).nullable().optional() }),
]);
type SyncTreeScopeRow = z.infer<typeof SyncTreeScopeRow>;

const SyncTreeSkippedRow = z.object({ model: z.enum(["collection", "table"]) });

// The items listing selects no entity id for a document, so the tree reads it off the document.
const SyncTreeDocumentRow = z.object({
  id: z.number().int(),
  entity_id: z.string().nullable(),
  name: z.string(),
  model: z.literal("document"),
});
type SyncTreeDocumentRow = z.infer<typeof SyncTreeDocumentRow>;

const SyncTreeItemRow = z.union([SyncTreeSkippedRow, SyncTreeDocumentRow, SyncTreeItem]);
type SyncTreeItemRow = z.infer<typeof SyncTreeItemRow>;

const SyncTreeDocument = z.object({ entity_id: z.string() });

type SyncTreeListedRow = SyncTreeDocumentRow | SyncTreeItem;

function isTreeItemRow(row: SyncTreeItemRow): row is SyncTreeListedRow {
  return row.model !== "collection" && row.model !== "table";
}

function isSyncTreeCollectionRow(row: SyncTreeScopeRow): row is SyncTreeCollectionRow {
  return row.is_remote_synced === true;
}

// A collection's location lists its ancestors' ids root first, so the last one is its parent.
function syncedParentId(location: string, syncedIds: ReadonlySet<number>): number | null {
  const parent = location.split("/").findLast((segment) => segment !== "");
  if (parent === undefined) {
    return null;
  }
  const parentId = Number(parent);
  return syncedIds.has(parentId) ? parentId : null;
}

// Servers from 64 read the items listing's parameters in kebab case and drop the snake-case name
// without a word, so the name is picked per server rather than sent both ways.
function dashboardQuestionsParam(features: Features): string {
  return features.collectionItemsKebabCaseParams
    ? "show-dashboard-questions"
    : "show_dashboard_questions";
}

const SyncDirtyFlag = z.object({ is_dirty: z.boolean() });

const SyncDirtyList = z.object({ dirty: z.array(SyncDirtyItem) });

const SyncBranchList = z.object({ items: z.array(z.string()) });

const SyncImportStarted = z.object({
  status: z.literal("success"),
  task_id: z.number().int().positive().nullable(),
  message: z.string().nullable().optional(),
});

const SyncExportStarted = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
});

const SyncStashStarted = z.object({
  status: z.literal("success"),
  message: z.string(),
  task_id: z.number().int().positive(),
});

const RemoteSyncSetting = z.string().nullable();

const WorktreeList = z.array(Worktree);

const FORBIDDEN_STATUS = 403;
const UNREGISTERED_STATUS = 404;

// The remote-sync settings are admin-readable only, and unregistered on servers without the
// remote-sync module; both answers mean "no usable remote", not a failure of the caller's request.
function isRemoteUnreadable(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }
  return error.status === FORBIDDEN_STATUS || error.status === UNREGISTERED_STATUS;
}

// Presence of `wait` is the choice to block: the schedule is the caller's, the terminal condition is
// the server's.
export interface SyncWaitParams {
  wait?: PollOptions | undefined;
}

export interface SyncRemoteChangesParams {
  "force-refresh"?: boolean | undefined;
}

export interface SyncImportParams extends SyncWaitParams {
  branch?: string | undefined;
  force?: boolean | undefined;
}

export interface SyncExportParams extends SyncWaitParams {
  message?: string | undefined;
  force?: boolean | undefined;
}

export interface SyncStashParams extends SyncWaitParams {
  new_branch: string;
  message: string;
}

export interface SyncCreateWorktreeParams {
  branch: string;
}

export interface SyncCreateBranchParams {
  name: string;
}

export function gitSyncResource(transport: Transport) {
  /** Get the running or most recently finished sync task, or null when the server has none. */
  async function currentTask(options: RequestOptions = {}): Promise<SyncTask | null> {
    await transport.require("gitSync.currentTask", options);
    return fetchOptionalParsed(transport, "/api/ee/remote-sync/current-task", SyncTask, options);
  }

  /** Request cancellation of the running sync task, and answer it in the state that left it. */
  async function cancelTask(options: RequestOptions = {}): Promise<SyncTask> {
    await transport.require("gitSync.cancelTask", options);
    return transport.requestParsed(SyncTask, "/api/ee/remote-sync/current-task/cancel", {
      ...options,
      method: "POST",
    });
  }

  /** Whether Metabase holds content changes the remote has not been told about. */
  async function isDirty(options: RequestOptions = {}): Promise<boolean> {
    await transport.require("gitSync.isDirty", options);
    const flag = await transport.requestParsed(SyncDirtyFlag, "/api/ee/remote-sync/is-dirty", {
      ...options,
    });
    return flag.is_dirty;
  }

  /** List the objects whose local state differs from the remote. */
  async function dirty(options: RequestOptions = {}): Promise<ListResult<SyncDirtyItem>> {
    await transport.require("gitSync.dirty", options);
    const response = await transport.requestParsed(SyncDirtyList, "/api/ee/remote-sync/dirty", {
      ...options,
    });
    return { data: response.dirty, total: null };
  }

  /**
   * Compare the tracked remote branch against what Metabase last imported. The server caches the
   * comparison; `force-refresh` re-reads the remote instead.
   */
  async function hasRemoteChanges(
    params: SyncRemoteChangesParams = {},
    options: RequestOptions = {},
  ): Promise<SyncRemoteChanges> {
    await transport.require("gitSync.hasRemoteChanges", options);
    return transport.requestParsed(SyncRemoteChanges, "/api/ee/remote-sync/has-remote-changes", {
      ...options,
      query: { "force-refresh": params["force-refresh"] },
    });
  }

  /**
   * Import content from the remote into Metabase. The endpoint queues a task and returns at once;
   * pass `wait` to poll that task until it reaches a terminal status. A server already up to date
   * answers no task id, and there is then nothing to poll.
   */
  async function importFromRemote(
    params: SyncImportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncImportResult> {
    await transport.require("gitSync.import", options);
    const started = await transport.requestParsed(SyncImportStarted, "/api/ee/remote-sync/import", {
      ...options,
      method: "POST",
      body: { branch: params.branch, force: params.force },
    });
    const message = started.message ?? null;
    if (params.wait === undefined || started.task_id === null) {
      return { message, task_id: started.task_id };
    }
    return { message, task_id: started.task_id, final: await settle(params.wait, options) };
  }

  /**
   * Export Metabase's content to the branch git-sync tracks, or inside a worktree to the worktree's
   * own branch. The endpoint queues a task and returns at once; pass `wait` to poll that task until
   * it reaches a terminal status.
   */
  async function exportToRemote(
    params: SyncExportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncExportResult> {
    await transport.require("gitSync.export", options);
    const started = await transport.requestParsed(SyncExportStarted, "/api/ee/remote-sync/export", {
      ...options,
      method: "POST",
      body: { message: params.message, force: params.force },
    });
    if (params.wait === undefined) {
      return { message: started.message, task_id: started.task_id };
    }
    return {
      message: started.message,
      task_id: started.task_id,
      final: await settle(params.wait, options),
    };
  }

  /**
   * Preview what exporting would do against the live remote, without writing: whether the remote
   * has moved on, whether a merge would apply cleanly, which entities conflict, and what a force
   * push would discard. The branch is the one git-sync tracks, or inside a worktree its own.
   */
  async function exportPreflight(options: RequestOptions = {}): Promise<SyncExportPreflight> {
    await transport.require("gitSync.exportPreflight", options);
    return transport.requestParsed(SyncExportPreflight, "/api/ee/remote-sync/export-preflight", {
      ...options,
    });
  }

  /**
   * Export Metabase's current content to a branch the remote does not have yet. The endpoint
   * queues a task and returns at once; pass `wait` to poll that task to a terminal status.
   */
  async function stash(
    params: SyncStashParams,
    options: RequestOptions = {},
  ): Promise<SyncStashResult> {
    await transport.require("gitSync.stash", options);
    const started = await transport.requestParsed(SyncStashStarted, "/api/ee/remote-sync/stash", {
      ...options,
      method: "POST",
      body: { new_branch: params.new_branch, message: params.message },
    });
    if (params.wait === undefined) {
      return { status: started.status, message: started.message, task_id: started.task_id };
    }
    return {
      status: started.status,
      message: started.message,
      task_id: started.task_id,
      final: await settle(params.wait, options),
    };
  }

  /** List the branches the configured remote carries. */
  async function branches(options: RequestOptions = {}): Promise<ListResult<string>> {
    await transport.require("gitSync.branches", options);
    const response = await transport.requestParsed(SyncBranchList, "/api/ee/remote-sync/branches", {
      ...options,
    });
    return { data: response.items, total: null };
  }

  /** Create a branch on the remote and point git-sync at it. */
  async function createBranch(
    params: SyncCreateBranchParams,
    options: RequestOptions = {},
  ): Promise<SyncBranchCreated> {
    await transport.require("gitSync.createBranch", options);
    return transport.requestParsed(SyncBranchCreated, "/api/ee/remote-sync/create-branch", {
      ...options,
      method: "POST",
      body: { name: params.name },
    });
  }

  /**
   * Mark one collection as git-synced, or unmark it. The server cascades the flag to descendants
   * by location prefix, and may queue an export task to carry the change to the remote.
   */
  async function setCollectionSynced(
    collectionId: number,
    synced: boolean,
    options: RequestOptions = {},
  ): Promise<SyncSettingsUpdateResult> {
    await transport.require("gitSync.setCollectionSynced", options);
    return transport.requestParsed(SyncSettingsUpdateResult, "/api/ee/remote-sync/settings", {
      ...options,
      method: "PUT",
      body: { collections: { [collectionId]: synced } },
    });
  }

  /** The collections currently in git-sync's scope. */
  async function syncedCollections(
    options: RequestOptions = {},
  ): Promise<ListResult<SyncScopeCollection>> {
    await transport.require("gitSync.syncedCollections", options);
    const data = await listCollectionsWithLibrary(transport, SyncScopeCollection, options);
    return { data: data.filter((entry) => entry.is_remote_synced === true), total: null };
  }

  /**
   * Every collection in git-sync's scope, flat, each with the items directly inside it, questions
   * saved to a dashboard included. A collection's `parent_id` is set only when its parent is synced
   * too. The collections are walked one after another.
   */
  async function syncedTree(options: RequestOptions = {}): Promise<SyncTree> {
    await transport.require("gitSync.syncedTree", options);
    const { features } = await transport.server(options);
    const scope = await listCollectionsWithLibrary(transport, SyncTreeScopeRow, options);
    const synced = scope.filter(isSyncTreeCollectionRow);
    const syncedIds = new Set(synced.map((collection) => collection.id));
    const query = { [dashboardQuestionsParam(features)]: true };

    const collections: SyncTreeCollection[] = [];
    for (const collection of synced) {
      const rows = await itemRows(collection.id, query, options);
      collections.push({
        id: collection.id,
        entity_id: collection.entity_id,
        name: collection.name,
        parent_id: syncedParentId(collection.location, syncedIds),
        items: await treeItems(rows, options),
      });
    }
    return { collections };
  }

  async function itemRows(
    collectionId: number,
    query: Record<string, QueryValue>,
    options: RequestOptions,
  ): Promise<SyncTreeItemRow[]> {
    const rows: SyncTreeItemRow[] = [];
    const pages = walkCollectionItems(transport, collectionId, SyncTreeItemRow, {
      query,
      ...(options.signal !== undefined && { signal: options.signal }),
    });
    for await (const page of pages) {
      rows.push(...page.items);
    }
    return rows;
  }

  async function treeItems(
    rows: SyncTreeItemRow[],
    options: RequestOptions,
  ): Promise<SyncTreeItem[]> {
    const items: SyncTreeItem[] = [];
    for (const row of rows.filter(isTreeItemRow)) {
      const entityId = row.entity_id ?? (await documentEntityId(row.id, options));
      items.push({ id: row.id, entity_id: entityId, name: row.name, model: row.model });
    }
    return items;
  }

  async function documentEntityId(id: number, options: RequestOptions): Promise<string> {
    const document = await transport.requestParsed(SyncTreeDocument, `/api/document/${id}`, {
      ...options,
    });
    return document.entity_id;
  }

  /** The remote's URL, or null when none is configured or the caller may not read it. */
  async function remoteUrl(options: RequestOptions = {}): Promise<string | null> {
    await transport.require("gitSync.remoteUrl", options);
    try {
      const url = await fetchOptionalParsed(
        transport,
        "/api/setting/remote-sync-url",
        RemoteSyncSetting,
        options,
      );
      return url === "" ? null : url;
    } catch (error) {
      if (isRemoteUnreadable(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * The branch git-sync tracks, or null when none is configured, the caller may not read it, or
   * the server has no remote-sync module.
   */
  async function branch(options: RequestOptions = {}): Promise<string | null> {
    await transport.require("gitSync.branch", options);
    try {
      return await fetchOptionalParsed(
        transport,
        "/api/setting/remote-sync-branch",
        RemoteSyncSetting,
        options,
      );
    } catch (error) {
      if (isRemoteUnreadable(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Poll the current task until it reaches a terminal status. A server with no task at all
   * answers null, which is terminal in the same sense: nothing further will happen.
   */
  async function waitForTask(
    wait: PollOptions,
    options: RequestOptions = {},
  ): Promise<SyncTask | null> {
    await transport.require("gitSync.waitForTask", options);
    return settle(wait, options);
  }

  /** List the remote-sync worktrees. */
  async function worktrees(options: RequestOptions = {}): Promise<ListResult<Worktree>> {
    await transport.require("gitSync.worktrees", options);
    const data = await transport.requestParsed(WorktreeList, "/api/ee/remote-sync/worktree", {
      ...options,
    });
    return { data, total: null };
  }

  /** Get one remote-sync worktree by id. */
  async function worktree(id: number, options: RequestOptions = {}): Promise<Worktree> {
    await transport.require("gitSync.worktree", options);
    try {
      return await transport.requestParsed(Worktree, `/api/ee/remote-sync/worktree/${id}`, {
        ...options,
      });
    } catch (error) {
      throw missingWorktree(error, id);
    }
  }

  /**
   * Create a remote-sync worktree for `branch`, which must already exist on the remote. A branch
   * holds at most one worktree; the server answers 400 for a second.
   */
  async function createWorktree(
    params: SyncCreateWorktreeParams,
    options: RequestOptions = {},
  ): Promise<Worktree> {
    await transport.require("gitSync.createWorktree", options);
    return transport.requestParsed(Worktree, "/api/ee/remote-sync/worktree", {
      ...options,
      method: "POST",
      body: { branch: params.branch },
    });
  }

  /** Delete a remote-sync worktree along with every piece of content it checked out. */
  async function deleteWorktree(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("gitSync.deleteWorktree", options);
    try {
      await transport.requestRaw(`/api/ee/remote-sync/worktree/${id}`, {
        ...options,
        method: "DELETE",
        expectContentType: "binary",
      });
    } catch (error) {
      throw missingWorktree(error, id);
    }
  }

  async function settle(wait: PollOptions, options: RequestOptions): Promise<SyncTask | null> {
    return pollUntil(
      async (signal) => currentTask({ ...options, signal }),
      (task) => task === null || isSyncTaskTerminal(task.status),
      wait,
    );
  }

  return {
    currentTask,
    cancelTask,
    isDirty,
    dirty,
    hasRemoteChanges,
    import: importFromRemote,
    export: exportToRemote,
    exportPreflight,
    stash,
    branches,
    createBranch,
    setCollectionSynced,
    syncedCollections,
    syncedTree,
    remoteUrl,
    branch,
    waitForTask,
    worktrees,
    worktree,
    createWorktree,
    deleteWorktree,
  };
}

// The server answers a missing worktree with the bare "Not found."; the id says which one.
function missingWorktree(error: unknown, id: number): unknown {
  if (error instanceof HttpError && error.kind === "resource-missing") {
    return chainRequestFailure(error, `No worktree has id ${id}.`);
  }
  return error;
}
