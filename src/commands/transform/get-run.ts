import { TransformRun, transformRunView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get-run", description: "Get a transform run by run id (not the transform id)" },
  capabilities: { minVersion: 59 },
  details:
    "The positional id is a RUN id (from `transform runs`), not a transform id. To fetch a transform itself, use `transform get <id>`.",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Run id (from `mb transform runs`)", required: true },
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
