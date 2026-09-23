import { TransformJob } from "@metabase/client/domain/transform-job";
import { transformJobView } from "../../output/views/transform-job";
import { renderItem } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform job by id" },
  requires: ["transformJob.get"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJob,
  examples: ["mb transform-job get 1", "mb transform-job get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const job = await client.transformJob.get(id);
    renderItem(job, transformJobView, ctx);
  },
});
