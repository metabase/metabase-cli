import { TransformRun, transformRunView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get-run", description: "Get a transform run by id" },
  capabilities: { minVersion: 58, edition: "ee", tokenFeature: "transforms" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Run id", required: true },
  },
  outputSchema: TransformRun,
  examples: ["mb transform get-run 1", "mb transform get-run 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "run id");
    const client = await getClient();
    const run = await client.requestParsed(TransformRun, `/api/transform/run/${id}`);
    renderItem(run, transformRunView, ctx);
  },
});
