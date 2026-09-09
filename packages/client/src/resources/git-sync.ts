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
} from "../domain/git-sync";
import { Worktree, type WorktreeCreateInput } from "../domain/worktree";
import { HttpError } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type PollOptions, pollUntil } from "../poll";

import { listCollectionsWithLibrary } from "./collection";
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

// `GET /api/ee/remote-sync/worktree` answers a bare array rather than a `{ data, total }` envelope,
// so the list carries no server-reported count.
const WorktreeApiList = z.array(Worktree);

const RemoteSyncSetting = z.string().nullable();

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

// A write names its scope as `worktree_id`; the task poll that follows it reads the same scope back
// under the query parameter's name.
function scopeOf(worktreeId: number | undefined): SyncScopeQuery {
  return { "worktree-id": worktreeId };
}

// Presence of `wait` is the choice to block: the schedule is the caller's, the terminal condition is
// the server's.
export interface SyncWaitParams {
  wait?: PollOptions | undefined;
}

// A remote-sync operation runs either against the main app or inside one worktree. Absent means the
// main app; the server takes the scope as a `worktree-id` query parameter on reads and a
// `worktree_id` body field on writes, and this follows those names verbatim.
export interface SyncScopeQuery {
  "worktree-id"?: number | undefined;
}

export interface SyncRemoteChangesParams extends SyncScopeQuery {
  "force-refresh"?: boolean | undefined;
}

export interface SyncExportPreflightParams extends SyncScopeQuery {
  branch: string;
}

export interface SyncCancelTaskParams {
  worktree_id?: number | undefined;
}

// `expected_branch` is the branch the caller believes the scope is on: the server rejects the
// import outright when it disagrees, rather than pulling a branch the caller did not mean.
export interface SyncImportParams extends SyncWaitParams {
  branch?: string | undefined;
  expected_branch: string;
  force?: boolean | undefined;
  merge?: boolean | undefined;
  worktree_id?: number | undefined;
}

export interface SyncExportParams extends SyncWaitParams {
  branch: string;
  message?: string | undefined;
  force?: boolean | undefined;
  merge?: boolean | undefined;
  worktree_id?: number | undefined;
}

export interface SyncStashParams extends SyncWaitParams {
  new_branch: string;
  message: string;
}

export interface SyncCreateBranchParams {
  name: string;
  checkout?: boolean | undefined;
}

export function gitSyncResource(transport: Transport) {
  /**
   * Get the running or most recently finished sync task in the scope, or null when the server has
   * none. `worktree-id` asks about a worktree's tasks instead of the main app's.
   */
  async function currentTask(
    params: SyncScopeQuery = {},
    options: RequestOptions = {},
  ): Promise<SyncTask | null> {
    return fetchOptionalParsed(transport, "/api/ee/remote-sync/current-task", SyncTask, {
      ...options,
      query: { "worktree-id": params["worktree-id"] },
    });
  }

  /**
   * Request cancellation of the running sync task, and answer it in the state that left it.
   * `worktree_id` cancels a worktree's task instead of the main app's.
   */
  async function cancelTask(
    params: SyncCancelTaskParams = {},
    options: RequestOptions = {},
  ): Promise<SyncTask> {
    return transport.requestParsed(SyncTask, "/api/ee/remote-sync/current-task/cancel", {
      ...options,
      method: "POST",
      body: { worktree_id: params.worktree_id },
    });
  }

  /**
   * Whether the scope holds content changes the remote has not been told about. `worktree-id` asks
   * about a worktree instead of the main app.
   */
  async function isDirty(
    params: SyncScopeQuery = {},
    options: RequestOptions = {},
  ): Promise<boolean> {
    const flag = await transport.requestParsed(SyncDirtyFlag, "/api/ee/remote-sync/is-dirty", {
      ...options,
      query: { "worktree-id": params["worktree-id"] },
    });
    return flag.is_dirty;
  }

  /**
   * List the objects whose local state differs from the remote. `worktree-id` asks about a worktree
   * instead of the main app.
   */
  async function dirty(
    params: SyncScopeQuery = {},
    options: RequestOptions = {},
  ): Promise<ListResult<SyncDirtyItem>> {
    const response = await transport.requestParsed(SyncDirtyList, "/api/ee/remote-sync/dirty", {
      ...options,
      query: { "worktree-id": params["worktree-id"] },
    });
    return { data: response.dirty, total: null };
  }

  /**
   * Compare the branch the scope tracks against what Metabase last imported. The server caches the
   * comparison; `force-refresh` re-reads the remote instead, and `worktree-id` checks a worktree's
   * own branch rather than the main app's.
   */
  async function hasRemoteChanges(
    params: SyncRemoteChangesParams = {},
    options: RequestOptions = {},
  ): Promise<SyncRemoteChanges> {
    return transport.requestParsed(SyncRemoteChanges, "/api/ee/remote-sync/has-remote-changes", {
      ...options,
      query: {
        "force-refresh": params["force-refresh"],
        "worktree-id": params["worktree-id"],
      },
    });
  }

  /**
   * Dry-run preview of what pushing the scope's current state would do against the live remote
   * branch, writing nothing: whether the remote has advanced, whether a three-way merge would
   * apply cleanly, the entities that conflict, the counts a merge would fold in, and the remote
   * content a force push would discard instead.
   */
  async function exportPreflight(
    params: SyncExportPreflightParams,
    options: RequestOptions = {},
  ): Promise<SyncExportPreflight> {
    return transport.requestParsed(SyncExportPreflight, "/api/ee/remote-sync/export-preflight", {
      ...options,
      query: { branch: params.branch, "worktree-id": params["worktree-id"] },
    });
  }

  /**
   * Import content from the remote into the scope. The endpoint queues a task and returns at once;
   * pass `wait` to poll that task until it reaches a terminal status. A server already up to date
   * answers no task id, and there is then nothing to poll. Inside a worktree the worktree's own
   * branch is the target and `branch` is ignored.
   */
  async function importFromRemote(
    params: SyncImportParams,
    options: RequestOptions = {},
  ): Promise<SyncImportResult> {
    const started = await transport.requestParsed(SyncImportStarted, "/api/ee/remote-sync/import", {
      ...options,
      method: "POST",
      body: {
        branch: params.branch,
        expected_branch: params.expected_branch,
        force: params.force,
        merge: params.merge,
        worktree_id: params.worktree_id,
      },
    });
    const message = started.message ?? null;
    if (params.wait === undefined || started.task_id === null) {
      return { message, task_id: started.task_id };
    }
    const scope = scopeOf(params.worktree_id);
    return { message, task_id: started.task_id, final: await settle(params.wait, scope, options) };
  }

  /**
   * Export the scope's content to the remote. The endpoint queues a task and returns at once; pass
   * `wait` to poll that task until it reaches a terminal status. `branch` must be the branch the
   * scope is already on — the worktree's own inside a worktree, the tracked one in the main app.
   */
  async function exportToRemote(
    params: SyncExportParams,
    options: RequestOptions = {},
  ): Promise<SyncExportResult> {
    const started = await transport.requestParsed(SyncExportStarted, "/api/ee/remote-sync/export", {
      ...options,
      method: "POST",
      body: {
        branch: params.branch,
        message: params.message,
        force: params.force,
        merge: params.merge,
        worktree_id: params.worktree_id,
      },
    });
    if (params.wait === undefined) {
      return { message: started.message, task_id: started.task_id };
    }
    const scope = scopeOf(params.worktree_id);
    return {
      message: started.message,
      task_id: started.task_id,
      final: await settle(params.wait, scope, options),
    };
  }

  /**
   * Export Metabase's current content to a branch the remote does not have yet. The endpoint
   * queues a task and returns at once; pass `wait` to poll that task to a terminal status.
   */
  async function stash(
    params: SyncStashParams,
    options: RequestOptions = {},
  ): Promise<SyncStashResult> {
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
      final: await settle(params.wait, {}, options),
    };
  }

  /** List the branches the configured remote carries. */
  async function branches(options: RequestOptions = {}): Promise<ListResult<string>> {
    const response = await transport.requestParsed(SyncBranchList, "/api/ee/remote-sync/branches", {
      ...options,
    });
    return { data: response.items, total: null };
  }

  /**
   * Create a branch on the remote from the branch git-sync is on. The instance checks the new
   * branch out by default; `checkout: false` creates it and leaves the instance where it is, which
   * is what checking a branch out into a worktree wants.
   */
  async function createBranch(
    params: SyncCreateBranchParams,
    options: RequestOptions = {},
  ): Promise<SyncBranchCreated> {
    return transport.requestParsed(SyncBranchCreated, "/api/ee/remote-sync/create-branch", {
      ...options,
      method: "POST",
      body: { name: params.name, checkout: params.checkout },
    });
  }

  /** List the remote-sync worktrees the caller can read. Worktrees are superuser-only. */
  async function worktrees(options: RequestOptions = {}): Promise<ListResult<Worktree>> {
    const data = await transport.requestParsed(WorktreeApiList, "/api/ee/remote-sync/worktree", {
      ...options,
    });
    return { data, total: null };
  }

  /** Get a single remote-sync worktree by id. */
  async function getWorktree(id: number, options: RequestOptions = {}): Promise<Worktree> {
    return transport.requestParsed(Worktree, `/api/ee/remote-sync/worktree/${id}`, { ...options });
  }

  /**
   * Create a remote-sync worktree for a branch. The branch is not created here — it is expected to
   * already exist on the remote — and its content is materialized by a subsequent import.
   */
  async function createWorktree(
    params: WorktreeCreateInput,
    options: RequestOptions = {},
  ): Promise<Worktree> {
    return transport.requestParsed(Worktree, "/api/ee/remote-sync/worktree", {
      ...options,
      method: "POST",
      body: { branch: params.branch },
    });
  }

  /** Delete a remote-sync worktree along with every piece of content it checked out. */
  async function deleteWorktree(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/remote-sync/worktree/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
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
    const data = await listCollectionsWithLibrary(transport, SyncScopeCollection, options);
    return { data: data.filter((entry) => entry.is_remote_synced === true), total: null };
  }

  /** The remote's URL, or null when none is configured or the caller may not read it. */
  async function remoteUrl(options: RequestOptions = {}): Promise<string | null> {
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

  /** The branch git-sync tracks, or null when none is configured or the caller may not read it. */
  async function branch(options: RequestOptions = {}): Promise<string | null> {
    return fetchOptionalParsed(
      transport,
      "/api/setting/remote-sync-branch",
      RemoteSyncSetting,
      options,
    );
  }

  /**
   * Poll the scope's current task until it reaches a terminal status. A server with no task at all
   * answers null, which is terminal in the same sense: nothing further will happen.
   */
  async function waitForTask(
    wait: PollOptions,
    params: SyncScopeQuery = {},
    options: RequestOptions = {},
  ): Promise<SyncTask | null> {
    return settle(wait, params, options);
  }

  async function settle(
    wait: PollOptions,
    scope: SyncScopeQuery,
    options: RequestOptions,
  ): Promise<SyncTask | null> {
    return pollUntil(
      async (signal) => currentTask(scope, { ...options, signal }),
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
    stash,
    branches,
    createBranch,
    exportPreflight,
    worktrees,
    getWorktree,
    createWorktree,
    deleteWorktree,
    setCollectionSynced,
    syncedCollections,
    remoteUrl,
    branch,
    waitForTask,
  };
}
