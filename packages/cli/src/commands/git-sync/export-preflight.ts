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
  details: [
    "Compares Metabase's content with the remote branch. `has_changes` says whether the remote moved past the last sync, `clean` whether a merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would bring in, and `force_push_casualties` names the remote content a force push would discard. `reason` is `history-rewritten` when the remote was force-pushed or rebased, so only `export --force` can push; otherwise it's `null`.",
    "When `has_changes` is `true` and `reason` is `null`: if `clean` is `true`, run `export --merge`; if it's `false`, run `create-branch <name>` and then `export`, and open a PR into the old branch.",
    "Before the first sync, `has_changes` is `false`, `clean` is `true` and the lists are empty, although a forced export then replaces the remote's managed folders whole. Servers that count a task that ended in `conflict` as a sync give the same answer after one, although the remote's changes aren't in Metabase and an export, `--merge` included, doesn't bring them in. So after a conflict, don't export on this answer: [keep one side, or both through a PR](#dont-answer-a-conflict-with-a-retry).",
  ].join("\n\n"),
  requires: ["gitSync.exportPreflight", "gitSync.trackedBranch"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description:
        "Branch to preview against. Defaults to the tracked branch (the `remote-sync-branch` setting), which it must be (409 otherwise); can't be blank",
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
