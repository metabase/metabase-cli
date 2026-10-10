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
import { FORBIDDEN_STATUS, HttpError, NOT_FOUND_STATUS } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type PollOptions, pollUntil } from "../poll";
import type { Features } from "../version/features";
import { profileFromProperties } from "../version/probe";
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
// probe, so the features a branch read, an import or an export judges by that same answer, and a
// refusal's explanation that follows, need no request of their own.
const RemoteSyncBranchProperty = SessionProperties.extend({
  "remote-sync-branch": z.string().nullable().optional(),
});
type RemoteSyncBranchProperty = z.infer<typeof RemoteSyncBranchProperty>;

// Absent when the caller may not read the setting, null when no remote is configured.
const RemoteSyncUrlProperty = SessionProperties.extend({
  "remote-sync-url": z.string().nullable().optional(),
});

// The token is sensitive, so the server shows it masked, and keeps the stored token when an
// update carries that masked form back.
interface SyncSettingsUpdateBody {
  collections: Record<number, boolean>;
  "remote-sync-url"?: string;
  "remote-sync-token"?: string;
}

const BRANCH_UNREADABLE_MESSAGE =
  "the remote-sync-branch setting is not readable: only admins see it, and a server without remote sync has none";
const BRANCH_UNSET_MESSAGE = "git-sync tracks no branch: the remote-sync-branch setting is unset";

// The remote-sync settings are admin-readable only, and unregistered on servers without the
// remote-sync module; both answers mean "no usable remote", not a failure of the caller's request.
function isRemoteUnreadable(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }
  return error.status === FORBIDDEN_STATUS || error.status === NOT_FOUND_STATUS;
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
  const { explain, refuse, refuseAfterReading } = explainer(transport, "gitSync");

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
   * branch as read just before the request, on every server with remote sync. A server that guards
   * the branch also requires it, so there the request is refused before the wire when the setting
   * is unset or hidden from the caller; a server without the guard ignores the assertion, and gets
   * none when there is none to read. `merge` folds the remote's changes into local content by a
   * three-way merge and keeps un-pushed local changes, where a plain import refuses on a dirty
   * instance.
   */
  async function importFromRemote(
    params: SyncImportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncImportResult> {
    const expectedBranch = await expectedBranchFor(params.expected_branch, options);
    await requireMerge(params.merge, options);
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

  // The import's assertion when the caller named none: the tracked branch, sent on every server
  // with remote sync, since one without the guard ignores it.
  async function expectedBranchFor(
    given: string | undefined,
    options: RequestOptions,
  ): Promise<string | undefined> {
    if (given !== undefined) {
      return given;
    }
    return importAssertion(await readTrackedBranch(options));
  }

  // The export's branch when the caller named none: the tracked one, only for a server that guards
  // it. An older server reads the setting itself in the same request and takes an export's branch
  // as a switch, so naming one read a moment earlier would undo a switch another admin made in
  // between.
  async function exportBranchFor(
    given: string | undefined,
    options: RequestOptions,
  ): Promise<string | undefined> {
    if (given !== undefined) {
      return given;
    }
    return exportBranch(await readTrackedBranch(options));
  }

  // The features are judged by the profile this same read describes, and the merge check that
  // follows finds this probe or a later one settled or in flight, so neither costs a request.
  async function readTrackedBranch(options: RequestOptions): Promise<TrackedBranchRead> {
    const properties = await transport.probe(RemoteSyncBranchProperty, options);
    return {
      tracked: properties["remote-sync-branch"],
      features: profileFromProperties(properties).features,
    };
  }

  // An import or export before `remoteSyncMerge` ignores `merge` and runs a plain one, which on a
  // dirty instance or a moved remote is the very outcome the merge was asked to avoid.
  async function requireMerge(merge: boolean | undefined, options: RequestOptions): Promise<void> {
    if (merge === true) {
      await transport.requireFeatures(["remoteSyncMerge"], options);
    }
  }

  /**
   * Export Metabase's content to the remote. The endpoint queues a task and returns at once; pass
   * `wait` to poll that task until it reaches a terminal status. A server that guards the tracked
   * branch refuses with 409 when `branch` is not the tracked one; left out, it is the tracked
   * branch as read just before the request, and the request is refused before the wire when the
   * setting is unset or hidden from the caller. A server without the guard exports to a named
   * `branch` and tracks it from then on; left out, it gets none and exports to its own. When the
   * remote has moved past the last sync, a plain export ends in a `conflict` task where `merge` is
   * available, and is refused with 400 before any task elsewhere; `merge` folds the remote's
   * changes in by a three-way merge instead, and `force` overwrites them.
   */
  async function exportToRemote(
    params: SyncExportParams = {},
    options: RequestOptions = {},
  ): Promise<SyncExportResult> {
    const branchName = await exportBranchFor(params.branch, options);
    await requireMerge(params.merge, options);
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
    const accepted = {
      message: started.message,
      task_id: started.task_id,
      branch: branchName ?? null,
    };
    if (params.wait === undefined) {
      return accepted;
    }
    return { ...accepted, final: await settle(params.wait, options) };
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
   * by location prefix, and may queue an import task to bring the instance in line with the
   * remote. A server without `remoteSyncCollectionsOnlyUpdate` validates every settings update as
   * a remote configuration and fails one naming no remote, after it has applied the flag, so it is
   * sent the remote's URL and its token as the server shows it, which it checks against the remote
   * and keeps as they are, or a blank URL when no remote is configured, which clears the remote
   * settings that are already empty.
   */
  async function setCollectionSynced(
    collectionId: number,
    synced: boolean,
    options: RequestOptions = {},
  ): Promise<SyncSettingsUpdateResult> {
    return transport.requestParsed(SyncSettingsUpdateResult, "/api/ee/remote-sync/settings", {
      ...options,
      method: "PUT",
      body: await settingsUpdateBody({ [collectionId]: synced }, options),
    });
  }

  async function settingsUpdateBody(
    collections: SyncSettingsUpdateBody["collections"],
    options: RequestOptions,
  ): Promise<SyncSettingsUpdateBody> {
    const { features } = await transport.server(options);
    if (features.remoteSyncCollectionsOnlyUpdate) {
      return { collections };
    }
    const properties = await transport.probe(RemoteSyncUrlProperty, options);
    const url = properties["remote-sync-url"];
    // Hidden from a caller who is not an admin, whose update the server refuses before reading it.
    if (url === undefined) {
      return { collections };
    }
    if (url === null) {
      return { collections, "remote-sync-url": "" };
    }
    const token = await fetchOptionalParsed(
      transport,
      "/api/setting/remote-sync-token",
      RemoteSyncSetting,
      options,
    );
    if (token === null) {
      return { collections, "remote-sync-url": url };
    }
    return { collections, "remote-sync-url": url, "remote-sync-token": token };
  }

  /** The collections currently in git-sync's scope. */
  async function syncedCollections(
    options: RequestOptions = {},
  ): Promise<ListResult<SyncScopeCollection>> {
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
  function branch(properties: RemoteSyncBranchProperty): string | null {
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
  function trackedBranch(properties: RemoteSyncBranchProperty): string {
    const tracked = branch(properties);
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
    // A server without remote sync lists its collections without `is_remote_synced`, which would
    // read as an empty sync scope rather than as a server with no git-sync at all.
    syncedCollections: refuse("syncedCollections", syncedCollections),
    remoteUrl,
    // An EE server without the remote_sync token still shows its admin the setting, which would
    // read as a branch git-sync tracks. The refusal judges the profile the setting's read settles,
    // so it costs no request of its own.
    branch: refuseAfterReading("branch", RemoteSyncBranchProperty, branch),
    trackedBranch: refuseAfterReading("trackedBranch", RemoteSyncBranchProperty, trackedBranch),
    waitForTask: explain("waitForTask", waitForTask),
  };
}

// The tracked branch as one read of the session properties found it, beside the features of the
// server that answered.
interface TrackedBranchRead {
  tracked: RemoteSyncBranchProperty["remote-sync-branch"];
  features: Features;
}

// Only a server that guards the branch rejects an import without the assertion, so only there is
// an unset or unreadable setting refused before the wire.
function importAssertion(read: TrackedBranchRead): string | undefined {
  if (!read.features.remoteSync) {
    return undefined;
  }
  if (read.features.remoteSyncBranchGuard) {
    return requiredBranch(read.tracked);
  }
  return typeof read.tracked === "string" ? read.tracked : undefined;
}

function exportBranch(read: TrackedBranchRead): string | undefined {
  if (!read.features.remoteSync || !read.features.remoteSyncBranchGuard) {
    return undefined;
  }
  return requiredBranch(read.tracked);
}

// A server guarding the branch requires it, so an unset setting, or one hidden from a caller who
// is not an admin, is refused before the wire.
function requiredBranch(tracked: RemoteSyncBranchProperty["remote-sync-branch"]): string {
  if (typeof tracked === "string") {
    return tracked;
  }
  throw new ConfigError(tracked === null ? BRANCH_UNSET_MESSAGE : BRANCH_UNREADABLE_MESSAGE);
}
