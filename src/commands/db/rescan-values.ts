import { z } from "zod";

import { databaseSyncResultView, DatabaseSyncResult } from "../../domain/database";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const RescanValuesApiResponse = z.object({ status: z.literal("ok") });

export default defineMetabaseCommand({
  meta: {
    name: "rescan-values",
    description: "Trigger a rescan of cached field values for a database",
  },
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
      RescanValuesApiResponse,
      `/api/database/${id}/rescan_values`,
      { method: "POST" },
    );
    renderItem({ id, status: response.status }, databaseSyncResultView, ctx);
  },
});
