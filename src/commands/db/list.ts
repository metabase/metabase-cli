import { z } from "zod";

import { Database, DatabaseCompact, databaseView } from "../../domain/database";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../../output/types";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const DatabaseListInclude = z.enum(["tables"]);

const DatabaseApiList = z
  .object({
    data: z.array(Database),
    total: z.number().int().nonnegative(),
  })
  .loose();

export const DatabaseListEnvelope = listEnvelopeSchema(DatabaseCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List databases" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    include: {
      type: "string",
      description: `Hydrate related entities: ${DatabaseListInclude.options.join("|")}`,
    },
    saved: {
      type: "boolean",
      description: "Include the Saved Questions virtual database",
    },
  },
  outputSchema: DatabaseListEnvelope,
  examples: [
    "mb db list",
    "mb db list --json",
    "mb db list --include tables --json",
    "mb db list --saved --json",
  ],
  async run({ args, ctx, getClient }) {
    const include = parseEnum(args.include, DatabaseListInclude, "--include");
    const saved = args.saved ? true : undefined;
    const client = await getClient();
    const response = await client.requestParsed(DatabaseApiList, "/api/database", {
      query: { include, saved },
    });

    const envelope: ListEnvelope<Database> = {
      data: response.data,
      returned: response.data.length,
      total: response.total,
    };
    renderList(envelope, databaseView, ctx);
  },
});
