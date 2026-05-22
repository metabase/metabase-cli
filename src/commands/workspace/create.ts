import { Workspace, WorkspaceCreateInput, workspaceView } from "../../domain/workspace";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a workspace" },
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    name: { type: "string", description: "Workspace name (alternative to --body / --file)" },
  },
  outputSchema: Workspace,
  examples: [
    'mb workspace create --name "analytics"',
    'echo \'{"name":"analytics"}\' | mb workspace create',
    "mb workspace create --file workspace.json",
  ],
  async run({ args, ctx, getClient }) {
    const body =
      args.name !== undefined && args.name !== ""
        ? WorkspaceCreateInput.parse({ name: args.name })
        : await readBody({ flag: args.body, file: args.file }, WorkspaceCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Workspace, "/api/ee/workspace-manager", {
      method: "POST",
      body,
    });
    const hasDatabases = (created.databases ?? []).length > 0;
    const hint = hasDatabases ? "" : " No databases yet — run `mb workspace database provision`.";
    renderSummary(
      created,
      workspaceView,
      `Created workspace ${created.id} "${created.name}".${hint}`,
      ctx,
    );
  },
});
