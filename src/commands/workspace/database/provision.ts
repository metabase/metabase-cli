import { Workspace, WorkspaceProvisionInput, workspaceView } from "../../../domain/workspace";
import { ConfigError } from "../../../core/errors";
import { renderItem } from "../../../output/render";
import { readBody } from "../../../runtime/body";
import { bodyInputFlags } from "../../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../../flags";
import { parseId } from "../../parse-id";
import { defineMetabaseCommand } from "../../runtime";
import { parseWaitFlags, waitFlags } from "../../wait-flags";

import { parseSchemasCsv } from "./parse-schemas";
import { waitForDatabaseProvisioned } from "./wait";

export default defineMetabaseCommand({
  meta: {
    name: "provision",
    description: "Provision a database into a workspace",
  },
  capabilities: { minVersion: 62, edition: "ee", tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...waitFlags,
    "database-id": { type: "string", description: "Database id (alternative to --body / --file)" },
    schemas: {
      type: "string",
      description: "Comma-separated input schemas (alternative to --body / --file)",
    },
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: Workspace,
  examples: [
    "mb workspace database provision 1 --database-id 5 --schemas analytics,github",
    "mb workspace database provision 1 --database-id 5 --schemas analytics --wait",
    "mb workspace database provision 1 --file provision.json",
  ],
  async run({ args, ctx, getClient }) {
    const workspaceId = parseId(args.id);
    const databaseIdFlag = args["database-id"];
    const schemasFlag = args.schemas;
    const wait = parseWaitFlags(args);

    let body: WorkspaceProvisionInput;
    if (databaseIdFlag !== undefined && databaseIdFlag !== "") {
      const databaseId = parseId(databaseIdFlag, "--database-id");
      if (schemasFlag === undefined || schemasFlag === "") {
        throw new ConfigError("--schemas is required when using --database-id");
      }
      const input_schemas = parseSchemasCsv(schemasFlag);
      body = WorkspaceProvisionInput.parse({ database_id: databaseId, input_schemas });
    } else {
      body = await readBody({ flag: args.body, file: args.file }, WorkspaceProvisionInput);
    }

    const client = await getClient();
    const initial = await client.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${workspaceId}/database`,
      { method: "POST", body },
    );

    const final = wait.enabled
      ? await waitForDatabaseProvisioned(client, workspaceId, body.database_id, wait.schedule)
      : initial;
    renderItem(final, workspaceView, ctx);
  },
});
