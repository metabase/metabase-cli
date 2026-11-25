import { DatabaseSyncResult } from "@metabase/client/domain/database";

import { renderSummary } from "../../output/render";
import { databaseSyncResultView } from "../../output/views/database";
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
    'Queues an async schema sync and returns `{ id, status: "ok" }` at once. `--wait` polls the database until its `initial_sync_status` is `complete` (at once for a database that already finished its first sync) and adds `initial_sync_status` to the result. To wait for a new transform table to register, use `mb transform run <id> --sync` instead.',
  requires: ["database.syncSchema"],
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
    const result = await client.database.syncSchema(id, {
      wait: wait.enabled ? wait.schedule : undefined,
    });

    const summary = wait.enabled
      ? `Schema sync for database ${id} complete.`
      : `Schema sync queued for database ${id}.`;
    renderSummary(result, databaseSyncResultView, summary, ctx);
  },
});
