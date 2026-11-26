import { z } from "zod";

import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const WorkspaceConfigResult = z.object({
  id: z.number().int(),
  config: z.string(),
});
type WorkspaceConfigResult = z.infer<typeof WorkspaceConfigResult>;

const workspaceConfigView: ResourceView<WorkspaceConfigResult> = {
  compactPick: WorkspaceConfigResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "config", label: "Config" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "config", description: "Print a workspace's developer-instance config" },
  details:
    "The YAML a developer instance boots from, as `config.yml`. It holds the workspace's warehouse login, so treat it as a secret. Text output is the YAML alone, so it can be written straight to a file. The server refuses with 409 while any of the workspace's databases is not `provisioned`: wait while one is `provisioning` or `deprovisioning`, and delete the workspace otherwise. It refuses with 422 when a database's connection settings need an admin to fix them, or the workspace has no databases.",
  requires: ["workspaceManager.config"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: WorkspaceConfigResult,
  examples: ["mb workspace config 1 --format text > config.yml", "mb workspace config 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const config = await client.workspaceManager.config(id);
    // The summary line gets its own newline, so the YAML's trailing one would leave a blank line.
    renderSummary({ id, config }, workspaceConfigView, config.trimEnd(), ctx);
  },
});
