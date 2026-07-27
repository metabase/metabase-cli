import { z } from "zod";

import { Collection } from "../domain/collection";
import {
  isSyncTaskTerminal,
  SyncBranchCreated,
  SyncDirtyItem,
  type SyncExportResult,
  type SyncImportResult,
  SyncRemoteChanges,
  SyncSettingsUpdateResult,
  type SyncStashResult,
  SyncTask,
} from "../domain/git-sync";
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
  branch?: string | undefined;
  message?: string | undefined;
  force?: boolean | undefined;
}

export interface SyncStashParams extends SyncWaitParams {
  new_branch: string;
  message: string;
}

export interface SyncCreateBranchParams {
  name: string;
}

export function gitSyncResource(transport: Transport) {
  /** Get the running or most recently finished sync task, or null when the server has none. */
  async function currentTask(options: RequestOptions = {}): Promise<SyncTask | null> {
    return fetchOptionalParsed(transport, "/api/ee/remote-sync/current-task", SyncTask, options);
  }

  /** Request cancellation of the running sync task, and answer it in the state that left it. */
  async function cancelTask(options: RequestOptions = {}): Promise<SyncTask> {
    return transport.requestParsed(SyncTask, "/api/ee/remote-sync/current-task/cancel", {
      ...options,
      method: "POST",
    });
  }

  /** Whether Metabase holds content changes the remote has not been told about. */
  async function isDirty(options: RequestOptions = {}): Promise<boolean> {
    const flag = await transport.requestParsed(SyncDirtyFlag, "/api/ee/remote-sync/is-dirty", {
      ...options,
    });
    return flag.is_dirty;
  }

  /** List the objects whose local state differs from the remote. */
  async function dirty(options: RequestOptions = {}): Promise<ListResult<SyncDirtyItem>> {
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
   * Export Metabase's content to the remote. The endpoint queues a task and returns at once; pass
   * `wait` to poll that task until it reaches a terminal status.
   */
  async function exportToRemote(
    params: SyncExportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncExportResult> {
    const started = await transport.requestParsed(SyncExportStarted, "/api/ee/remote-sync/export", {
      ...options,
      method: "POST",
      body: { branch: params.branch, message: params.message, force: params.force },
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
      final: await settle(params.wait, options),
    };
  }

  /** List the branches the configured remote carries. */
  async function branches(options: RequestOptions = {}): Promise<ListResult<string>> {
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
   * Poll the current task until it reaches a terminal status. A server with no task at all
   * answers null, which is terminal in the same sense: nothing further will happen.
   */
  async function waitForTask(
    wait: PollOptions,
    options: RequestOptions = {},
  ): Promise<SyncTask | null> {
    return settle(wait, options);
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
    stash,
    branches,
    createBranch,
    setCollectionSynced,
    syncedCollections,
    remoteUrl,
    branch,
    waitForTask,
  };
}
