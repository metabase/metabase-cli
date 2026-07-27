import { SyncRemoteChanges } from "@metabase/client/domain/git-sync";

import { renderSummary } from "../../output/render";
import { syncRemoteChangesView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "has-remote-changes",
    description: "Check whether the remote branch has unimported changes",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    forceRefresh: {
      type: "boolean",
      description: "Bypass the in-memory cache and re-check the remote",
      default: false,
      alias: "force-refresh",
    },
  },
  outputSchema: SyncRemoteChanges,
  examples: [
    "mb git-sync has-remote-changes",
    "mb git-sync has-remote-changes --force-refresh --json",
  ],
  async run({ args, ctx, getClient }) {
    const mb = await getClient();
    const result = await mb.gitSync.hasRemoteChanges({ "force-refresh": args.forceRefresh });
    const base = result.has_changes
      ? `The remote branch has changes not yet imported (remote ${result.remote_version ?? "?"}, local ${result.local_version ?? "?"}).`
      : "Up to date with the remote branch.";
    renderSummary(result, syncRemoteChangesView, result.cached ? `${base} (cached)` : base, ctx);
  },
});
