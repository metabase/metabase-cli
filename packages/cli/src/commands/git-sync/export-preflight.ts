import { SyncExportPreflight } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";

import { renderSummary } from "../../output/render";
import { formatExportPreflight, syncExportPreflightView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "export-preflight",
    description: "Preview what an export would do against the live remote branch, without writing",
  },
  details:
    "Compares the current Metabase content with the remote branch. `has_changes` says whether the remote has advanced past the last synced version (false when nothing has been synced yet), `clean` whether a three-way merge would apply without conflicts, `conflicts` names the entities that would conflict, `summary` counts the remote changes a merge would fold in, `force_push_casualties` names the remote content a force push would discard, and `reason` is `history-rewritten` when the remote was force-pushed or rebased so no merge base exists. The branch must be the one git-sync tracks; the server answers 409 otherwise.",
  requires: ["gitSync.exportPreflight", "gitSync.branch"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description: "Branch to preview against (defaults to the remote-sync-branch setting)",
      alias: "b",
    },
  },
  outputSchema: SyncExportPreflight,
  examples: ["mb git-sync export-preflight", "mb git-sync export-preflight --branch main --json"],
  async run({ args, ctx, getClient }) {
    const mb = await getClient();
    const requested = args.branch === undefined || args.branch === "" ? null : args.branch;
    const branch = requested ?? (await mb.gitSync.branch());
    if (branch === null) {
      throw new ConfigError(
        "the tracked git-sync branch could not be read (the remote-sync-branch setting is unset or unreadable); pass --branch <name>",
      );
    }
    const result = await mb.gitSync.exportPreflight({ branch });
    renderSummary(
      result,
      syncExportPreflightView,
      () => formatExportPreflight(branch, result),
      ctx,
    );
  },
});
