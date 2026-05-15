import { FieldValues, fieldValuesView } from "../../domain/field";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "values",
    description: "Fetch the cached distinct values for a field (FieldValues list)",
  },
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
    renderItem(values, fieldValuesView, ctx);
  },
});
