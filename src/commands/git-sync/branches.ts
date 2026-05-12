import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

const SyncBranchesApiResponse = z.object({
  items: z.array(z.string()),
});

const BranchRow = z.object({ name: z.string() });
type BranchRow = z.infer<typeof BranchRow>;

const branchView: ResourceView<BranchRow> = {
  compactPick: BranchRow,
  tableColumns: [{ key: "name", label: "Branch" }],
};

export const SyncBranchListEnvelope = listEnvelopeSchema(BranchRow);

export default defineMetabaseCommand({
  meta: { name: "branches", description: "List branches on the configured git remote" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncBranchListEnvelope,
  examples: ["metabase git-sync branches", "metabase git-sync branches --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const response = await client.requestParsed(
      SyncBranchesApiResponse,
      REMOTE_SYNC_PATHS.branches,
    );
    const rows: BranchRow[] = response.items.map((name) => ({ name }));
    renderList(wrapList(rows), branchView, ctx);
  },
});
