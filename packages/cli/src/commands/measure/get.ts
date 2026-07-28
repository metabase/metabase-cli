import { Measure } from "@metabase/client/domain/measure";
import { measureView } from "../../output/views/measure";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a measure by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Measure id", required: true },
  },
  outputSchema: Measure,
  examples: ["mb measure get 1", "mb measure get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const measure = await client.measure.get(id);
    renderItem(measure, measureView, ctx);
  },
});
