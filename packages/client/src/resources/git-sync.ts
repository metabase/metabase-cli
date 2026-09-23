import { z } from "zod";

import { isSyncTaskTerminal, type SyncImportResult, SyncTask } from "../domain/git-sync";
import { HttpError } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import { type PollOptions, pollUntil } from "../poll";

import { fetchOptionalParsed } from "./optional-parsed";

const SyncImportStarted = z.object({
  status: z.literal("success"),
  task_id: z.number().int().positive().nullable(),
  message: z.string().nullable().optional(),
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

export interface SyncImportParams extends SyncWaitParams {
  branch?: string | undefined;
  force?: boolean | undefined;
}

export function gitSyncResource(transport: Transport) {
  /** Get the running or most recently finished sync task, or null when the server has none. */
  async function currentTask(options: RequestOptions = {}): Promise<SyncTask | null> {
    await transport.require("gitSync.currentTask", options);
    return fetchOptionalParsed(transport, "/api/ee/remote-sync/current-task", SyncTask, options);
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

  async function settle(wait: PollOptions, options: RequestOptions): Promise<SyncTask | null> {
    return pollUntil(
      async (signal) => currentTask({ ...options, signal }),
      (task) => task === null || isSyncTaskTerminal(task.status),
      wait,
    );
  }

  return {
    currentTask,
    import: importFromRemote,
    branch,
  };
}
