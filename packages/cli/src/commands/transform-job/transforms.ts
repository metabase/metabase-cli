import { TransformCompact } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformJobTransformsEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "transforms", description: "List the transforms that carry one of a job's tags" },
  details:
    "The list leaves out the dependencies of those transforms, which `mb transform-job run` also runs.",
  requires: ["transformJob.transforms"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJobTransformsEnvelope,
  examples: ["mb transform-job transforms 1", "mb transform-job transforms 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data } = await client.transformJob.transforms(id);
    renderList(windowList(data, ctx.range), transformView, ctx);
  },
});
