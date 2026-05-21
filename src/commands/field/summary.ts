import { FieldSummary, FieldSummaryRaw, fieldSummaryView } from "../../domain/field";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "summary",
    description: "Get the row count and distinct count for a field",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id", required: true },
  },
  outputSchema: FieldSummary,
  examples: ["mb field summary 100", "mb field summary 100 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const [[, count], [, distincts]] = await client.requestParsed(
      FieldSummaryRaw,
      `/api/field/${id}/summary`,
    );
    const summary: FieldSummary = { field_id: id, count, distincts };
    renderItem(summary, fieldSummaryView, ctx);
  },
});
