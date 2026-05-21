import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

export const HasRemoteChangesResult = z.object({
  has_changes: z.boolean(),
  remote_version: z.string().nullable(),
  local_version: z.string().nullable(),
  cached: z.boolean(),
});
type HasRemoteChangesResult = z.infer<typeof HasRemoteChangesResult>;

const hasRemoteChangesView: ResourceView<HasRemoteChangesResult> = {
  compactPick: HasRemoteChangesResult,
  tableColumns: [
    { key: "has_changes", label: "Has changes" },
    { key: "remote_version", label: "Remote" },
    { key: "local_version", label: "Local" },
    { key: "cached", label: "Cached" },
  ],
};

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
  outputSchema: HasRemoteChangesResult,
  examples: [
    "mb git-sync has-remote-changes",
    "mb git-sync has-remote-changes --force-refresh --json",
  ],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const result = await client.requestParsed(
      HasRemoteChangesResult,
      REMOTE_SYNC_PATHS.hasRemoteChanges,
      { query: { "force-refresh": args.forceRefresh } },
    );
    renderItem(result, hasRemoteChangesView, ctx);
  },
});
