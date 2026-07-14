import { z } from "zod";

import { clearProfile, readProfileCredential } from "../../core/auth/storage";
import { ConfigError, errorMessage } from "../../core/errors";
import { createClient, type Client } from "../../core/http/client";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { promptConfirm } from "../../output/prompt";
import { renderSummary } from "../../output/render";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { SyncExportKickoff } from "../git-sync/export";
import { IsDirtyResult } from "../git-sync/is-dirty";
import { pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "../git-sync/poll-task";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { workspaceProfileName } from "./profile-name";

const WorkspaceOrphanedResource = z
  .object({
    workspace_database_id: z.number().int(),
    database_id: z.number().int(),
    driver: z.string(),
    schema: z.string(),
    user: z.string(),
    reason: z.string().nullable().optional(),
  })
  .loose();

const WorkspaceDeleteResponse = z
  .object({
    id: z.number().int(),
    deleted: z.boolean(),
    message: z.string().optional(),
    orphaned_resources: z.array(WorkspaceOrphanedResource).optional(),
  })
  .loose();

export const WorkspaceDestroyResult = WorkspaceDeleteResponse.extend({
  aborted: z.boolean(),
});
export type WorkspaceDestroyResultJson = z.infer<typeof WorkspaceDestroyResult>;

const workspaceDestroyView: ResourceView<WorkspaceDestroyResultJson> = {
  compactPick: WorkspaceDestroyResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "deleted", label: "Destroyed" },
    { key: "aborted", label: "Aborted" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "destroy", description: "Destroy a workspace and its warehouse isolation" },
  details:
    "Destroy is the only irreversible moment, so it closes the work-loss window first: when a local profile named ws-<id> exists, the child is checked for unsynced work and a dirty workspace is auto-exported to its target branch before anything is torn down (--discard skips the check and the export). Then each provisioned database's warehouse isolation (temporary schema + user) is dropped and the workspace removed; the matching local profile is dropped on success. Refuses with a 409 while any database is still provisioning/deprovisioning unless --ignore-pending is passed, which removes the workspace records and leaves those warehouse objects behind. If the warehouse was unreachable, the result lists the leftover schema/user objects under orphaned_resources.",
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    discard: {
      type: "boolean",
      description: "Destroy without exporting unsynced work (skips the is-dirty check)",
      default: false,
    },
    "ignore-pending": {
      type: "boolean",
      description: "Remove workspace records even while databases are provisioning/deprovisioning",
      default: false,
    },
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: WorkspaceDestroyResult,
  examples: [
    "mb workspace destroy 1 --yes",
    "mb workspace destroy 1 --yes --discard",
    "mb workspace destroy 1 --yes --ignore-pending",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    if (!args.yes) {
      if (process.stdin.isTTY !== true) {
        throw new ConfigError(
          `refusing to destroy workspace ${id} without confirmation — pass --yes to proceed non-interactively`,
        );
      }
      const ok = await promptConfirm({
        message: `Destroy workspace ${id}? Its warehouse isolation (schema + user) is dropped.`,
        initialValue: false,
      });
      if (!ok) {
        renderSummary(
          { id, deleted: false, aborted: true },
          workspaceDestroyView,
          `Aborted; workspace ${id} was not destroyed.`,
          ctx,
        );
        return;
      }
    }
    const client = await getClient();
    const profileName = workspaceProfileName(id);
    const hasProfile = await guardUnsyncedWork(profileName, args.discard);
    const response = await client.requestParsed(
      WorkspaceDeleteResponse,
      `/api/ee/workspace-manager/${id}`,
      {
        method: "DELETE",
        query: { "ignore-pending": args["ignore-pending"] ? true : undefined },
      },
    );
    if (response.deleted && hasProfile) {
      await clearProfile(profileName);
      warn(`dropped profile "${profileName}"`);
    }
    renderSummary(
      { ...response, aborted: false },
      workspaceDestroyView,
      response.message ?? `Destroyed workspace ${id}.`,
      ctx,
    );
  },
});

// The dirty check needs the child's credential, which only exists on machines that created or
// connected to this workspace. Without one the check is impossible — destroy must still work
// (it is the billing-stop lever), so warn and proceed rather than block ops cleanup.
async function guardUnsyncedWork(profileName: string, discard: boolean): Promise<boolean> {
  const resolved = await readProfileCredential(profileName);
  if (resolved === null) {
    warn(`no local profile "${profileName}" for this workspace — skipping the unsynced-work check`);
    return false;
  }
  if (discard) {
    warn("--discard given — skipping the unsynced-work check");
    return true;
  }
  const child = createClient({ url: resolved.url, credential: resolved.credential });
  const dirty = await checkIsDirty(child, profileName);
  if (!dirty) {
    return true;
  }
  warn("workspace has unsynced work — exporting to the target branch before destroy");
  await exportUnsyncedWork(child);
  return true;
}

async function checkIsDirty(child: Client, profileName: string): Promise<boolean> {
  try {
    const result = await child.requestParsed(IsDirtyResult, REMOTE_SYNC_PATHS.isDirty);
    return result.is_dirty;
  } catch (error) {
    throw new ConfigError(
      `could not check workspace profile "${profileName}" for unsynced work: ${errorMessage(error)} — pass --discard to destroy anyway`,
    );
  }
}

async function exportUnsyncedWork(child: Client): Promise<void> {
  const kickoff = await child.requestParsed(SyncExportKickoff, REMOTE_SYNC_PATHS.export, {
    method: "POST",
    body: {},
  });
  const final = await pollSyncTask(child, {
    intervalMs: DEFAULT_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  throwIfFailedTask(final, "export");
  warn(`export task #${kickoff.task_id} completed; unsynced work is saved`);
}
