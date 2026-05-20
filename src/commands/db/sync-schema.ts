import { z } from "zod";

import { databaseSyncResultView, DatabaseSyncResult } from "../../domain/database";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const SyncSchemaApiResponse = z.object({ status: z.literal("ok") });

export default defineMetabaseCommand({
  meta: {
    name: "sync-schema",
    description: "Trigger a manual schema sync for a database",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DatabaseSyncResult,
  examples: ["mb db sync-schema 1", "mb db sync-schema 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const response = await client.requestParsed(
      SyncSchemaApiResponse,
      `/api/database/${id}/sync_schema`,
      { method: "POST" },
    );
    renderItem({ id, status: response.status }, databaseSyncResultView, ctx);
  },
});
