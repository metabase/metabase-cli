import { z } from "zod";

import { Database, DatabaseCompact, databaseView } from "../../domain/database";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const DatabaseApiList = z
  .object({
    data: z.array(Database),
    total: z.number().int().nonnegative(),
  })
  .loose();

export const DatabaseListEnvelope = listEnvelopeSchema(DatabaseCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List databases" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: DatabaseListEnvelope,
  examples: ["metabase db list", "metabase db list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const response = await client.requestParsed(DatabaseApiList, "/api/database");

    const envelope: ListEnvelope<Database> = {
      data: response.data,
      returned: response.data.length,
      total: response.total,
    };
    renderList(envelope, databaseView, ctx);
  },
});
