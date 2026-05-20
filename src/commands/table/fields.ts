import { FieldCompact, fieldView } from "../../domain/field";
import { TableQueryMetadata } from "../../domain/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const FieldListEnvelope = listEnvelopeSchema(FieldCompact);

export default defineMetabaseCommand({
  meta: {
    name: "fields",
    description: "List fields on a table (projection over query_metadata.fields)",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: FieldListEnvelope,
  examples: ["mb table fields 42", "mb table fields 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const table = await client.requestParsed(TableQueryMetadata, `/api/table/${id}/query_metadata`);
    renderList(wrapList(table.fields), fieldView, ctx);
  },
});
