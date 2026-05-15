import { z } from "zod";

import { Workspace, WorkspaceCompact, workspaceView } from "../../domain/workspace";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const WorkspaceApiList = z.array(Workspace);

export const WorkspaceListEnvelope = listEnvelopeSchema(WorkspaceCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List workspaces" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: WorkspaceListEnvelope,
  examples: ["mb workspace list", "mb workspace list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(WorkspaceApiList, "/api/ee/workspace-manager");
    renderList(wrapList(items), workspaceView, ctx);
  },
});
