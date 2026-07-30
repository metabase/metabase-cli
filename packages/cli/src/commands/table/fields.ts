import { FieldCompact } from "@metabase/client/domain/field";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { fieldView } from "../../output/views/field";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const FieldListEnvelope = listEnvelopeSchema(FieldCompact);

export default defineMetabaseCommand({
  meta: {
    name: "fields",
    description: "List fields on a table (projection over query_metadata.fields)",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: FieldListEnvelope,
  examples: ["mb table fields 42", "mb table fields 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const table = await client.table.queryMetadata(id);
    renderList(windowList(table.fields, ctx.range), fieldView, ctx);
  },
});
