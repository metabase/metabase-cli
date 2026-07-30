import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

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
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: IsDirtyResult,
  examples: ["mb git-sync is-dirty", "mb git-sync is-dirty --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const result: IsDirtyResult = { is_dirty: await mb.gitSync.isDirty() };
    renderSummary(result, isDirtyView, result.is_dirty ? "dirty" : "clean", ctx);
  },
});
