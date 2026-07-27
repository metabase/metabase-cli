import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const SchemaName = z.object({ name: z.string() });
type SchemaName = z.infer<typeof SchemaName>;

const schemaNameView: ResourceView<SchemaName> = {
  compactPick: SchemaName,
  tableColumns: [{ key: "name", label: "Schema" }],
};

export const DatabaseSchemaListEnvelope = listEnvelopeSchema(SchemaName);

export default defineMetabaseCommand({
  meta: { name: "schemas", description: "List schemas in a database" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DatabaseSchemaListEnvelope,
  examples: ["mb db schemas 1", "mb db schemas 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data } = await client.database.schemas(id);
    const rows: SchemaName[] = data.map((name) => ({ name }));
    renderList(windowList(rows, ctx.range), schemaNameView, ctx);
  },
});
