import { Workspace, WorkspaceUpdateDatabaseInput, workspaceView } from "../../../domain/workspace";
import { ConfigError } from "../../../core/errors";
import { renderItem } from "../../../output/render";
import { readBody } from "../../../runtime/body";
import { parseCsv } from "../../../runtime/csv";
import { bodyInputFlags } from "../../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../../flags";
import { parseId } from "../../parse-id";
import { defineMetabaseCommand } from "../../runtime";
import { parseWaitFlags, waitFlags } from "../../wait-flags";

import { waitForDatabaseProvisioned } from "./wait";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description:
      "Update a workspace's database (deprovisions then re-provisions with new input schemas)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...waitFlags,
    schemas: {
      type: "string",
      description: "Comma-separated input schemas (alternative to --body / --file)",
    },
    id: { type: "positional", description: "Workspace id", required: true },
    "db-id": { type: "positional", description: "Database id", required: true },
  },
  outputSchema: Workspace,
  examples: [
    "metabase workspace database update 1 5 --schemas analytics,github",
    "metabase workspace database update 1 5 --schemas analytics --wait",
    "metabase workspace database update 1 5 --file update.json",
  ],
  async run({ args, ctx, getClient }) {
    const workspaceId = parseId(args.id);
    const databaseId = parseId(args["db-id"], "db-id");
    const schemasFlag = args.schemas;
    const wait = parseWaitFlags(args);

    let body: WorkspaceUpdateDatabaseInput;
    if (schemasFlag !== undefined && schemasFlag !== "") {
      const schemas = parseSchemas(schemasFlag);
      body = WorkspaceUpdateDatabaseInput.parse({ input_schemas: schemas });
    } else {
      body = await readBody({ flag: args.body, file: args.file }, WorkspaceUpdateDatabaseInput);
    }

    const client = await getClient();
    const initial = await client.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${workspaceId}/database/${databaseId}`,
      { method: "PUT", body },
    );

    const final = wait.enabled
      ? await waitForDatabaseProvisioned(client, workspaceId, databaseId, wait.schedule)
      : initial;
    renderItem(final, workspaceView, ctx);
  },
});

function parseSchemas(raw: string): string[] {
  const parts = parseCsv(raw);
  if (parts.length === 0) {
    throw new ConfigError("--schemas must contain at least one schema name");
  }
  return parts;
}
