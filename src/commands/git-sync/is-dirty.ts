import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

export const IsDirtyResult = z.object({
  is_dirty: z.boolean(),
});
type IsDirtyResult = z.infer<typeof IsDirtyResult>;

const isDirtyView: ResourceView<IsDirtyResult> = {
  compactPick: IsDirtyResult,
  tableColumns: [{ key: "is_dirty", label: "Dirty" }],
};

export default defineMetabaseCommand({
  meta: {
    name: "is-dirty",
    description: "Check whether Metabase has unsynced local changes",
  },
  capabilities: { minVersion: 60, edition: "ee", tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: IsDirtyResult,
  examples: ["mb git-sync is-dirty", "mb git-sync is-dirty --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const result = await client.requestParsed(IsDirtyResult, REMOTE_SYNC_PATHS.isDirty);
    renderItem(result, isDirtyView, ctx);
  },
});
