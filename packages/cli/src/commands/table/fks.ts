import { TableForeignKeyCompact } from "@metabase/client/domain/table";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { tableForeignKeyView } from "../../output/views/table";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TableForeignKeyListEnvelope = listEnvelopeSchema(TableForeignKeyCompact);

export default defineMetabaseCommand({
  meta: {
    name: "fks",
    description:
      "List the foreign keys pointing at a table (every field that targets one of its fields)",
  },
  requires: ["table.fks"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: TableForeignKeyListEnvelope,
  examples: ["mb table fks 42", "mb table fks 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data } = await client.table.fks(id);
    renderList(windowList(data, ctx.range), tableForeignKeyView, ctx);
  },
});
