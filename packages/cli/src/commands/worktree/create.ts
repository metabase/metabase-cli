import { z } from "zod";

import type { MetabaseClient } from "@metabase/client/client";
import { SyncImportResult } from "@metabase/client/domain/git-sync";
import { Worktree, WorktreeCompact } from "@metabase/client/domain/worktree";
import { ConfigError } from "@metabase/client/errors";
import type { SyncImportParams } from "@metabase/client/resources/git-sync";

import { readProfileRecord, writeProfileWorktree } from "../../core/auth/storage";
import { renderSummary } from "../../output/render";
import { EMPTY_CELL } from "../../output/table";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "../git-sync/sync-task";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

export const WorktreeCreateResult = z.object({
  worktree: Worktree,
  branch_created: z.boolean(),
  pull: SyncImportResult.nullable(),
});
type WorktreeCreateResult = z.infer<typeof WorktreeCreateResult>;

// The server hydrates `creator` onto the worktree it answers with; the default projection trims it
// to the same four columns `worktree list` and `worktree get` show, and --full still carries it.
const WorktreeCreateResultCompact = WorktreeCreateResult.extend({ worktree: WorktreeCompact });

const worktreeCreateView: ResourceView<WorktreeCreateResult> = {
  compactPick: WorktreeCreateResultCompact,
  tableColumns: [
    { key: "worktree", label: "Worktree", format: (value) => renderWorktreeCell(value) },
    { key: "branch_created", label: "Branch created" },
    { key: "pull", label: "Pull", format: (value) => renderPullCell(value) },
  ],
};

function renderWorktreeCell(value: unknown): string {
  const parsed = Worktree.safeParse(value);
  return parsed.success ? `${parsed.data.id} (${parsed.data.branch})` : EMPTY_CELL;
}

function renderPullCell(value: unknown): string {
  const parsed = SyncImportResult.safeParse(value);
  if (!parsed.success) {
    return EMPTY_CELL;
  }
  return parsed.data.task_id === null ? "no task" : `task #${parsed.data.task_id}`;
}

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a git-sync worktree for a branch and pull the branch into it",
  },
  capabilities: { minVersion: 64, tokenFeature: "remote_sync" },
  worktree: "any",
  details:
    "A worktree is bound to its branch for life. The branch is created on the remote first when it is missing, " +
    "then the branch's content is pulled into the worktree so the checkout starts in sync.",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: { type: "positional", description: "Branch to check out", required: true },
    pull: {
      type: "boolean",
      description: "Import the branch into the new worktree (default: true; --no-pull skips it)",
      default: true,
    },
    createBranch: {
      type: "boolean",
      description:
        "Create the branch on the remote when it is missing (default: true; --no-create-branch assumes it exists)",
      default: true,
      alias: "create-branch",
    },
    pin: {
      type: "boolean",
      description: "Pin the profile to the new worktree so every later command runs inside it",
      default: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: WorktreeCreateResult,
  examples: [
    "mb worktree create feat/transforms",
    "mb worktree create feat/transforms --pin --json",
    "mb worktree create feat/transforms --no-create-branch --no-pull",
  ],
  async run({ args, ctx, getClient, getResolvedConfig }) {
    const branch = args.branch.trim();
    if (branch === "") {
      throw new ConfigError("invalid branch: branch name must not be blank");
    }
    const wait = parseWaitFlags(args);
    const profile = (await getResolvedConfig()).profile;
    await assertPinAllows(profile, branch);

    const mb = await getClient();
    const branchCreated = args.createBranch ? await ensureBranch(mb, branch) : false;
    const worktree = await mb.gitSync.createWorktree({ branch });

    const pull = args.pull ? await pullBranch(mb, worktree.id, branch, wait) : null;
    if (args.pin) {
      await writeProfileWorktree(profile, { id: worktree.id, branch: worktree.branch });
    }

    const result: WorktreeCreateResult = { worktree, branch_created: branchCreated, pull };
    renderSummary(result, worktreeCreateView, () => summarize(result, profile, args.pin), ctx);
    throwIfFailedTask(pull?.final ?? null, "import");
  },
});

async function assertPinAllows(profile: string, branch: string): Promise<void> {
  const pin = (await readProfileRecord(profile))?.worktree ?? null;
  if (pin === null || pin.branch === branch) {
    return;
  }
  throw new ConfigError(
    `profile "${profile}" is pinned to worktree ${pin.id} (${pin.branch}); ` +
      `refusing to create a worktree for branch "${branch}"`,
  );
}

async function ensureBranch(mb: MetabaseClient, branch: string): Promise<boolean> {
  const { data } = await mb.gitSync.branches();
  if (data.includes(branch)) {
    return false;
  }
  await mb.gitSync.createBranch({ name: branch, checkout: false });
  return true;
}

async function pullBranch(
  mb: MetabaseClient,
  worktreeId: number,
  branch: string,
  wait: ReturnType<typeof parseWaitFlags>,
): Promise<SyncImportResult> {
  const params: SyncImportParams = {
    branch,
    expected_branch: branch,
    worktree_id: worktreeId,
  };
  if (wait.enabled) {
    params.wait = taskPollOptions(wait.schedule);
  }
  return mb.gitSync.import(params);
}

function summarize(result: WorktreeCreateResult, profile: string, pinned: boolean): string {
  const origin = result.branch_created ? " (branch created on the remote)" : "";
  const lines = [
    `Created worktree ${result.worktree.id} for branch "${result.worktree.branch}"${origin}.`,
  ];
  if (result.pull === null) {
    lines.push("Skipped the initial pull; the worktree is empty until you import into it.");
  } else if (result.pull.final !== null && result.pull.final !== undefined) {
    lines.push(formatSyncTask(result.pull.final));
  } else if (result.pull.task_id === null) {
    lines.push(result.pull.message ?? "Nothing to import.");
  } else {
    lines.push(`Started import task #${result.pull.task_id}.`);
  }
  if (pinned) {
    lines.push(`Pinned profile "${profile}" to worktree ${result.worktree.id}.`);
  }
  return lines.join("\n");
}
