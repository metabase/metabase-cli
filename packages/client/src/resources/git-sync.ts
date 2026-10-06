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
import { SessionProperties } from "../domain/session-properties";
import { ConfigError } from "../errors";
import { HttpError } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type PollOptions, pollUntil } from "../poll";
import type { Features } from "../version/features";
import { explainer } from "../version/refusal";

import { listCollectionsAs } from "./collection";
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

// `/api/setting/remote-sync-branch` answers nothing for a branch set by environment variable, while
// the session properties carry every setting's effective value, and carry a setting only when the
// caller may read it: an absent key is "not readable", a null one "unset". They are read as a
// probe, so the merge check and a refusal's explanation that follow the read need no request of
// their own.
const RemoteSyncBranchProperty = SessionProperties.extend({
  "remote-sync-branch": z.string().nullable().optional(),
});
type RemoteSyncBranchProperty = z.infer<typeof RemoteSyncBranchProperty>;

const BRANCH_UNREADABLE_MESSAGE =
  "the remote-sync-branch setting is not readable: it is visible to admins only";
const BRANCH_UNSET_MESSAGE = "git-sync tracks no branch: the remote-sync-branch setting is unset";

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

// Presence of `wait` is the choice to block: the schedule is the caller's, the terminal condition
// is the server's.
export interface SyncWaitParams {
  wait?: PollOptions | undefined;
}

export interface SyncRemoteChangesParams {
  "force-refresh"?: boolean | undefined;
}

export interface SyncImportParams extends SyncWaitParams {
  branch?: string | undefined;
  force?: boolean | undefined;
  merge?: boolean | undefined;
  expected_branch?: string | undefined;
}

export interface SyncExportParams extends SyncWaitParams {
  branch?: string | undefined;
  message?: string | undefined;
  force?: boolean | undefined;
  merge?: boolean | undefined;
}

export interface SyncExportPreflightParams {
  branch: string;
}

export interface SyncStashParams extends SyncWaitParams {
  new_branch: string;
  message: string;
}

export interface SyncCreateBranchParams {
  name: string;
}

export function gitSyncResource(transport: Transport) {
  const { explain } = explainer(transport, "gitSync");

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
   * answers no task id, and there is then nothing to poll. A server that guards the tracked branch
   * refuses with 409 when `expected_branch` disagrees with the setting; left out, it is the tracked
   * branch as read just before the request, which a server without the guard ignores. A guarding
   * server granting remote sync is refused before the request when the setting is unset or hidden
   * from the caller; any other server then gets no expected branch. `merge` folds the remote's
   * changes into local content by a three-way merge and keeps un-pushed local changes, where a
   * plain import refuses on a dirty instance.
   */
  async function importFromRemote(
    params: SyncImportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncImportResult> {
    const expectedBranch = await syncBranch(params.expected_branch, params.merge, options);
    const started = await transport.requestParsed(SyncImportStarted, "/api/ee/remote-sync/import", {
      ...options,
      method: "POST",
      body: {
        branch: params.branch,
        force: params.force,
        merge: params.merge,
        expected_branch: expectedBranch,
      },
    });
    const message = started.message ?? null;
    if (params.wait === undefined || started.task_id === null) {
      return { message, task_id: started.task_id };
    }
    return { message, task_id: started.task_id, final: await settle(params.wait, options) };
  }

  // The tracked branch, sent on every server whenever the setting names one: a server guarding it
  // requires it on an import and an export, and an older one ignores it or takes it as its own
  // default. A guarding server granting remote sync would reject a request without it, so there an
  // unset setting, or one hidden from a caller who is not an admin, is refused before the wire.
  // Anywhere else the request goes without it: an older server picks its own default, and one
  // without remote sync refuses in its own words. The merge check and the features both read the
  // profile the branch read settles, so neither costs a request.
  async function syncBranch(
    given: string | undefined,
    merge: boolean | undefined,
    options: RequestOptions,
  ): Promise<string | undefined> {
    const properties =
      given === undefined ? await transport.probe(RemoteSyncBranchProperty, options) : null;
    if (merge === true) {
      await transport.requireFeatures(["remoteSyncMerge"], options);
    }
    if (properties === null) {
      return given;
    }
    const { features } = await transport.verifiedServer(options);
    return defaultBranch(properties["remote-sync-branch"], features);
  }

  /**
   * Export Metabase's content to the remote. The endpoint queues a task and returns at once; pass
   * `wait` to poll that task until it reaches a terminal status. A server that guards the tracked
   * branch refuses with 409 when `branch` is not the tracked one; left out, it is the tracked
   * branch as read just before the request, which is the default of a server without the guard.
   * A guarding server granting remote sync is refused before the request when the setting is unset
   * or hidden from the caller; any other server then gets no branch and picks its own. When the
   * remote has moved past the last sync, a plain export ends in a `conflict` task where `merge` is
   * available, and is refused with 400 before any task elsewhere; `merge` folds the remote's
   * changes in by a three-way merge instead, and `force` overwrites them.
   */
  async function exportToRemote(
    params: SyncExportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncExportResult> {
    const branchName = await syncBranch(params.branch, params.merge, options);
    const started = await transport.requestParsed(SyncExportStarted, "/api/ee/remote-sync/export", {
      ...options,
      method: "POST",
      body: {
        branch: branchName,
        message: params.message,
        force: params.force,
        merge: params.merge,
      },
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
   * Preview what exporting to `branch` would do against the live remote, without writing: whether
   * the remote has moved on, whether a merge would apply cleanly, which entities conflict, and what
   * a force push would discard. `branch` must be the one git-sync tracks; the server answers 409
   * otherwise.
   */
  async function exportPreflight(
    params: SyncExportPreflightParams,
    options: RequestOptions = {},
  ): Promise<SyncExportPreflight> {
    return transport.requestParsed(SyncExportPreflight, "/api/ee/remote-sync/export-preflight", {
      ...options,
      query: { branch: params.branch },
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
    // A server without remote sync lists its collections without `is_remote_synced`, which would
    // read as an empty sync scope rather than as a server with no git-sync at all.
    await transport.requireFeatures(["remoteSync"], options);
    const data = await listCollectionsAs(transport, SyncScopeCollection, options);
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

  /**
   * The branch git-sync tracks, or null when none is configured. Refuses when the server has no
   * remote sync or the caller may not read the setting (it is admin-only), rather than reading
   * either as unset.
   */
  async function branch(options: RequestOptions = {}): Promise<string | null> {
    const properties = await transport.probe(RemoteSyncBranchProperty, options);
    // An EE server without the remote_sync token still shows its admin the setting, which would
    // read as a branch git-sync tracks; the profile the read just settled refuses it without
    // another request.
    await transport.requireFeatures(["remoteSync"], options);
    const tracked = properties["remote-sync-branch"];
    if (tracked === undefined) {
      throw new ConfigError(BRANCH_UNREADABLE_MESSAGE);
    }
    return tracked;
  }

  /**
   * The branch git-sync tracks, refused when none is configured, the server has no remote sync, or
   * the caller may not read it.
   */
  async function trackedBranch(options: RequestOptions = {}): Promise<string> {
    const tracked = await branch(options);
    if (tracked === null) {
      throw new ConfigError(BRANCH_UNSET_MESSAGE);
    }
    return tracked;
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
    currentTask: explain("currentTask", currentTask),
    cancelTask: explain("cancelTask", cancelTask),
    isDirty: explain("isDirty", isDirty),
    dirty: explain("dirty", dirty),
    hasRemoteChanges: explain("hasRemoteChanges", hasRemoteChanges),
    import: explain("import", importFromRemote),
    export: explain("export", exportToRemote),
    exportPreflight: explain("exportPreflight", exportPreflight),
    stash: explain("stash", stash),
    branches: explain("branches", branches),
    createBranch: explain("createBranch", createBranch),
    setCollectionSynced: explain("setCollectionSynced", setCollectionSynced),
    syncedCollections,
    remoteUrl,
    branch,
    trackedBranch,
    waitForTask: explain("waitForTask", waitForTask),
  };
}

function defaultBranch(
  tracked: RemoteSyncBranchProperty["remote-sync-branch"],
  features: Features,
): string | undefined {
  if (typeof tracked === "string") {
    return tracked;
  }
  if (!features.remoteSync || !features.remoteSyncBranchGuard) {
    return undefined;
  }
  throw new ConfigError(tracked === null ? BRANCH_UNSET_MESSAGE : BRANCH_UNREADABLE_MESSAGE);
}
