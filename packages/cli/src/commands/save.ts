import { resolve } from "node:path";

import { SyncImportResult } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";
import { z } from "zod";

import { renderSummary } from "../output/render";
import type { ResourceView } from "../output/view";
import { runProcess } from "../runtime/process";
import { assertCheckPassed, checkRepo } from "./check";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";
import { defineMetabaseCommand } from "./runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "./wait-flags";

const SaveResult = z.object({
  branch: z.string(),
  commit: z.string().nullable(),
  import: SyncImportResult,
});
type SaveResult = z.infer<typeof SaveResult>;

const saveView: ResourceView<SaveResult> = {
  compactPick: SaveResult,
  tableColumns: [
    { key: "branch", label: "Branch" },
    { key: "commit", label: "Commit" },
  ],
};

async function git(folder: string, args: readonly string[]): Promise<string> {
  const result = await runProcess("git", ["-C", folder, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function hasStagedChanges(folder: string): Promise<boolean> {
  const result = await runProcess("git", ["-C", folder, "diff", "--cached", "--quiet"]);
  return result.exitCode !== 0;
}

function importSummary(result: SyncImportResult): string {
  if (result.task_id === null) {
    return result.message ?? "Metabase is already up to date.";
  }
  const final = result.final ?? null;
  return final === null ? `Import task #${result.task_id} started.` : formatSyncTask(final);
}

export default defineMetabaseCommand({
  meta: {
    name: "save",
    description: "Check, commit, push, and import the repository into Metabase",
  },
  details:
    "Runs `mb check` first and refuses to continue on any failure. Then stages every change (`git add -A`), commits it with --message (skipped when nothing is staged), pushes the current branch, and triggers a Metabase git-sync import, waiting for it to finish. The current branch must be the branch Metabase syncs from (the `remote-sync-branch` setting); save refuses otherwise.",
  skills: [{ skill: "core", purpose: "the metadata -> edit -> check -> save loop" }],
  requires: ["gitSync.branch", "gitSync.import"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    message: { type: "string", description: "Commit message", alias: "m", required: true },
    folder: {
      type: "positional",
      description: "Repository folder (default: current directory)",
      required: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SaveResult,
  examples: ['mb save -m "add revenue dashboard"', 'mb save ./my-repo -m "fix filter" --json'],
  async run({ args, ctx, getClient }) {
    const folder = resolve(args.folder ?? ".");
    const report = checkRepo(folder);
    assertCheckPassed(report, ctx);

    const mb = await getClient();
    const [localBranch, syncBranch] = await Promise.all([
      git(folder, ["rev-parse", "--abbrev-ref", "HEAD"]),
      mb.gitSync.branch(),
    ]);
    if (syncBranch !== localBranch) {
      throw new ConfigError(
        `current branch is "${localBranch}" but Metabase syncs from "${syncBranch ?? "(unset)"}"; switch branches before saving`,
      );
    }

    await git(folder, ["add", "-A"]);
    let commit: string | null = null;
    if (await hasStagedChanges(folder)) {
      await git(folder, ["commit", "-m", args.message]);
      commit = await git(folder, ["rev-parse", "HEAD"]);
    }
    await git(folder, ["push", "origin", localBranch]);

    const wait = parseWaitFlags(args);
    const imported = await mb.gitSync.import(
      wait.enabled ? { wait: taskPollOptions(wait.schedule) } : {},
    );
    const result: SaveResult = { branch: localBranch, commit, import: imported };
    const committed = commit === null ? "Nothing to commit" : `Committed ${commit.slice(0, 7)}`;
    renderSummary(
      result,
      saveView,
      `${committed}; pushed ${localBranch}. ${importSummary(imported)}`,
      ctx,
    );
    throwIfFailedTask(imported.final ?? null, "import");
  },
});
