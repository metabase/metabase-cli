import { TransformJob, transformJobView } from "../../domain/transform-job";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform job by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJob,
  examples: ["mb transform-job get 1", "mb transform-job get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const job = await client.requestParsed(TransformJob, `/api/transform-job/${id}`);
    renderItem(job, transformJobView, ctx);
  },
});
