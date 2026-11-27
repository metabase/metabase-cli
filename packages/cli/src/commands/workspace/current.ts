import { z } from "zod";

import { WorkspaceInstance } from "@metabase/client/domain/workspace-instance";
import { renderItem, renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { workspaceInstanceView } from "../../output/views/workspace";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const NoWorkspaceLoaded = z.object({ loaded: z.literal(false) });
type NoWorkspaceLoaded = z.infer<typeof NoWorkspaceLoaded>;

export const CurrentWorkspaceResult = z.union([WorkspaceInstance, NoWorkspaceLoaded]);

const noWorkspaceView: ResourceView<NoWorkspaceLoaded> = {
  compactPick: NoWorkspaceLoaded,
  tableColumns: [{ key: "loaded", label: "Loaded" }],
};

export default defineMetabaseCommand({
  meta: { name: "current", description: "Show the workspace loaded on this instance" },
  details:
    "The workspace this instance runs in, from its `config.yml` at boot or set at runtime. An instance that only manages workspaces has none loaded. `can_write` is false when deployment config set the workspace, which then cannot be changed at runtime. Admins only.",
  requires: ["workspaceInstance.current"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: CurrentWorkspaceResult,
  examples: ["mb workspace current", "mb workspace current --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const instance = await client.workspaceInstance.current();
    if (instance === null) {
      const none: NoWorkspaceLoaded = { loaded: false };
      renderSummary(none, noWorkspaceView, "No workspace is loaded on this instance.", ctx);
      return;
    }
    renderItem(instance, workspaceInstanceView, ctx);
  },
});
