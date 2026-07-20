import {
  Database,
  databaseSyncResultView,
  DatabaseSyncResult,
  DatabaseTaskAck,
} from "../../domain/database";
import { renderSummary } from "../../output/render";
import { pollUntil } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { parseWaitFlags, waitFlags } from "../wait-flags";

export default defineMetabaseCommand({
  meta: {
    name: "sync-schema",
    description: "Trigger a manual schema sync for a database",
  },
  details:
    "Queues an async schema sync and returns immediately. Pass --wait to poll the database until its initial_sync_status reports `complete` (a database that has already finished its initial sync returns at once). To wait for a specific newly-materialized transform table to register, prefer `mb transform run <id> --sync`.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...waitFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DatabaseSyncResult,
  examples: ["mb db sync-schema 1", "mb db sync-schema 1 --wait --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const wait = parseWaitFlags(args);
    const client = await getClient();
    const response = await client.requestParsed(
      DatabaseTaskAck,
      `/api/database/${id}/sync_schema`,
      { method: "POST" },
    );

    if (!wait.enabled) {
      renderSummary(
        { id, status: response.status },
        databaseSyncResultView,
        `Schema sync queued for database ${id}.`,
        ctx,
      );
      return;
    }

    const database = await pollUntil(
      async () => client.requestParsed(Database, `/api/database/${id}`),
      (db) => db.initial_sync_status === "complete",
      wait.schedule,
    );

    renderSummary(
      { id, status: response.status, initial_sync_status: database.initial_sync_status ?? null },
      databaseSyncResultView,
      `Schema sync for database ${id} complete.`,
      ctx,
    );
  },
});
