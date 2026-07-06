import { Workspace, workspaceView } from "../../domain/workspace";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseIdCsv } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create and provision a workspace" },
  details:
    "Attaches the given databases and provisions warehouse isolation (a temporary schema + user per database) before returning. Each database must be eligible for workspaces; provisioning is blocking, so the response carries the final per-database status.",
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    name: { type: "string", description: "Workspace name", required: true },
    "database-ids": {
      type: "string",
      description: "Database ids to attach, comma separated",
      required: true,
    },
  },
  outputSchema: Workspace,
  examples: [
    "mb workspace create --name ws-reports --database-ids 1",
    "mb workspace create --name ws-etl --database-ids 1,2 --json",
  ],
  async run({ args, ctx, getClient }) {
    const databaseIds = parseIdCsv(args["database-ids"], "database id");
    const client = await getClient();
    const created = await client.requestParsed(Workspace, "/api/ee/workspace-manager/", {
      method: "POST",
      body: { name: args.name, database_ids: databaseIds },
    });
    renderSummary(
      created,
      workspaceView,
      `Created workspace ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
