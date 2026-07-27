import { DatabaseCompact, DatabaseListInclude } from "@metabase/client/domain/database";
import { databaseView } from "../../output/views/database";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DatabaseListEnvelope = listEnvelopeSchema(DatabaseCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List databases" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
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
    const { data, total } = await client.database.list({ include, saved });

    renderList(windowList(data, ctx.range, total), databaseView, ctx);
  },
});
