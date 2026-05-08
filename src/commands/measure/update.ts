import { Measure, MeasureUpdateInput, measureView } from "../../domain/measure";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description:
      "Update a measure by id; body must include revision_message (audit-logged with the change)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Measure id", required: true },
  },
  outputSchema: Measure,
  examples: [
    "cat patch.json | metabase measure update 1",
    "metabase measure update 1 --file patch.json",
    'metabase measure update 1 --body \'{"name":"renamed","revision_message":"rename"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, MeasureUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Measure, `/api/measure/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, measureView, ctx);
  },
});
