import { WorkspaceCompact } from "@metabase/client/domain/workspace";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { workspaceView } from "../../output/views/workspace";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const WorkspaceListEnvelope = listEnvelopeSchema(WorkspaceCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List workspaces" },
  details:
    "Lists every workspace with its databases and each one's provisioning status (`unprovisioned`, `provisioning`, `provisioned` or `deprovisioning`). Admins only.",
  requires: ["workspaceManager.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: WorkspaceListEnvelope,
  examples: ["mb workspace list", "mb workspace list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.workspaceManager.list();
    renderList(windowList(data, ctx.range, total), workspaceView, ctx);
  },
});
