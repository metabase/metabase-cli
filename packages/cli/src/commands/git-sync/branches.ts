import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const BranchRow = z.object({ name: z.string() });
type BranchRow = z.infer<typeof BranchRow>;

const branchView: ResourceView<BranchRow> = {
  compactPick: BranchRow,
  tableColumns: [{ key: "name", label: "Branch" }],
};

const SyncBranchListEnvelope = listEnvelopeSchema(BranchRow);

export default defineMetabaseCommand({
  meta: { name: "branches", description: "List branches on the configured git remote" },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncBranchListEnvelope,
  examples: ["mb git-sync branches", "mb git-sync branches --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const { data } = await mb.gitSync.branches();
    const rows: BranchRow[] = data.map((name) => ({ name }));
    renderList(windowList(rows, ctx.range), branchView, ctx);
  },
});
