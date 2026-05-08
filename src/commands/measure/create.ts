import { Measure, MeasureCreateInput, measureView } from "../../domain/measure";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a measure from a JSON spec" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  outputSchema: Measure,
  examples: [
    "cat measure.json | metabase measure create",
    "metabase measure create --file measure.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, MeasureCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Measure, "/api/measure", {
      method: "POST",
      body,
    });
    renderItem(created, measureView, ctx);
  },
});
