import { SyncExportPreflight } from "@metabase/client/domain/git-sync";

import { renderSummary } from "../../output/render";
import { formatExportPreflight, syncExportPreflightView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { branchFlag } from "./branch-flag";

export default defineMetabaseCommand({
  meta: {
    name: "export-preflight",
    description: "Preview what an export would do against the live remote branch, without writing",
  },
  details:
    "Compares the current Metabase content with the remote branch. `has_changes` says whether the remote has advanced past the last synced version (false when nothing has been synced yet, and after a task that ended in `conflict`, which the server counts as synced), `clean` whether a three-way merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would fold in, `force_push_casualties` names the remote content a force push would discard (empty when nothing has been synced yet, although a forced export then replaces the remote's managed directories wholesale), and `reason` is `history-rewritten` when the remote was force-pushed or rebased so no merge base exists. The branch must be the one git-sync tracks; the server answers 409 otherwise.",
  requires: ["gitSync.exportPreflight", "gitSync.trackedBranch"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description:
        "Branch to preview against (defaults to the remote-sync-branch setting; must be that branch)",
      alias: "b",
    },
  },
  outputSchema: SyncExportPreflight,
  examples: ["mb git-sync export-preflight", "mb git-sync export-preflight --branch main --json"],
  async run({ args, ctx, getClient }) {
    const given = branchFlag(args.branch);
    const mb = await getClient();
    const branch = given ?? (await mb.gitSync.trackedBranch());
    const result = await mb.gitSync.exportPreflight({ branch });
    renderSummary(
      result,
      syncExportPreflightView,
      () => formatExportPreflight(branch, result),
      ctx,
    );
  },
});
