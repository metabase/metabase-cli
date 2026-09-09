import { SyncExportPreflight } from "@metabase/client/domain/git-sync";
import type { SyncExportPreflightParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncExportPreflightView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { resolveSyncBranch } from "./branch";

export { SyncExportPreflight };

export default defineMetabaseCommand({
  meta: {
    name: "export-preflight",
    description: "Preview what exporting to the remote branch would do, without writing anything",
  },
  capabilities: { minVersion: 63, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details:
    "Compares the local state against the live remote branch: whether a three-way merge would " +
    "apply cleanly, which entities conflict, and what a --force push would discard. " +
    "Inside a worktree the branch is the worktree's own, so --branch is refused there. " +
    WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    branch: {
      type: "string",
      description: "Branch to preview against (defaults to remote-sync-branch setting)",
      alias: "b",
    },
  },
  outputSchema: SyncExportPreflight,
  examples: [
    "mb git-sync export-preflight",
    "mb git-sync export-preflight --json",
    "mb git-sync export-preflight --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const target = await resolveSyncBranch(mb, scope, args.branch);

    const params: SyncExportPreflightParams = { branch: target.branch, ...scopeQuery(scope) };
    const preflight = await mb.gitSync.exportPreflight(params);
    renderSummary(preflight, syncExportPreflightView, summarize(preflight, target.branch), ctx);
  },
});

function summarize(preflight: SyncExportPreflight, branch: string): string {
  const lines = [`${countsSentence(preflight)} against branch "${branch}".`];
  if (preflight.conflicts.length > 0) {
    lines.push(`Conflicts (${preflight.conflicts.length}): ${preflight.conflicts.join(", ")}.`);
  }
  const casualties = casualtiesSentence(preflight);
  if (casualties !== null) {
    lines.push(casualties);
  }
  if (preflight.reason !== null) {
    lines.push(`Reason: ${preflight.reason}.`);
  }
  return lines.join("\n");
}

function countsSentence(preflight: SyncExportPreflight): string {
  if (!preflight.has_changes) {
    return "Nothing to export";
  }
  const { added, updated, removed } = preflight.summary;
  const counts = `${added} added, ${updated} updated, ${removed} removed`;
  return preflight.clean
    ? `Exporting would apply cleanly: ${counts}`
    : `Exporting would not apply cleanly: ${counts}`;
}

function casualtiesSentence(preflight: SyncExportPreflight): string | null {
  const { deleted, overwritten } = preflight.force_push_casualties;
  if (deleted.length === 0 && overwritten.length === 0) {
    return null;
  }
  return (
    `A --force push would delete ${deleted.length} and overwrite ${overwritten.length} ` +
    "remote objects."
  );
}
