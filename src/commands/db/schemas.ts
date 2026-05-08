import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const SchemaName = z.object({ name: z.string() });
type SchemaName = z.infer<typeof SchemaName>;

const schemaNameView: ResourceView<SchemaName> = {
  compactPick: SchemaName,
  tableColumns: [{ key: "name", label: "Schema" }],
};

const SchemasApiResponse = z.array(z.string());

export const DatabaseSchemaListEnvelope = listEnvelopeSchema(SchemaName);

export default defineMetabaseCommand({
  meta: { name: "schemas", description: "List schemas in a database" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  outputSchema: DatabaseSchemaListEnvelope,
  examples: ["metabase db schemas 1", "metabase db schemas 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const names = await client.requestParsed(SchemasApiResponse, `/api/database/${id}/schemas`);
    const rows: SchemaName[] = names.map((name) => ({ name }));
    renderList(wrapList(rows), schemaNameView, ctx);
  },
});
