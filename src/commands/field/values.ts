import { FieldValues, fieldValuesView } from "../../domain/field";
import { formatScalar, renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "values",
    description: "Fetch the cached distinct values for a field (FieldValues list)",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id", required: true },
  },
  outputSchema: FieldValues,
  examples: ["mb field values 100", "mb field values 100 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const values = await client.requestParsed(FieldValues, `/api/field/${id}/values`);
    const fieldId = values.field_id ?? id;
    const count = values.values.length;
    renderSummary(
      values,
      fieldValuesView,
      () => {
        if (count === 0) {
          return `Field ${fieldId} has no cached values.`;
        }
        const more =
          values.has_more_values === true ? " (more available; rescan for the full set)" : "";
        const header = `Field ${fieldId} has ${count} cached value${count === 1 ? "" : "s"}${more}:`;
        const lines = values.values.map((row) => `  ${formatScalar(row[0])}`);
        return [header, ...lines].join("\n");
      },
      ctx,
    );
  },
});
