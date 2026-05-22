import { confirmAndDelete, DeleteResult } from "../../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../../flags";
import { parseId } from "../../parse-id";
import { defineMetabaseCommand } from "../../runtime";
import { parseWaitFlags, waitFlags } from "../../wait-flags";

import { waitForDatabaseGone } from "./wait";

export default defineMetabaseCommand({
  meta: {
    name: "deprovision",
    description: "Deprovision a database from a workspace",
  },
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...waitFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Workspace id", required: true },
    "db-id": { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DeleteResult,
  examples: [
    "mb workspace database deprovision 1 5 --yes",
    "mb workspace database deprovision 1 5 --yes --wait",
  ],
  async run({ args, ctx, getClient }) {
    const workspaceId = parseId(args.id);
    const databaseId = parseId(args["db-id"], "db-id");
    const wait = parseWaitFlags(args);
    const client = await getClient();
    await confirmAndDelete({
      id: databaseId,
      path: `/api/ee/workspace-manager/${workspaceId}/database/${databaseId}`,
      yes: args.yes,
      promptMessage: `Deprovision database ${databaseId} from workspace ${workspaceId}?`,
      successMessage: `Deprovisioned database ${databaseId} from workspace ${workspaceId}.`,
      abortMessage: `Aborted; database ${databaseId} was not deprovisioned.`,
      client,
      ctx,
      ...(wait.enabled
        ? { afterDelete: () => waitForDatabaseGone(client, workspaceId, databaseId, wait.schedule) }
        : {}),
    });
  },
});
