import { databaseSyncResultView, DatabaseSyncResult, DatabaseTaskAck } from "../../domain/database";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "rescan-values",
    description: "Trigger a rescan of cached field values for a database",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DatabaseSyncResult,
  examples: ["mb db rescan-values 1", "mb db rescan-values 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const response = await client.requestParsed(
      DatabaseTaskAck,
      `/api/database/${id}/rescan_values`,
      { method: "POST" },
    );
    renderSummary(
      { id, status: response.status },
      databaseSyncResultView,
      `Field-values rescan queued for database ${id}.`,
      ctx,
    );
  },
});
