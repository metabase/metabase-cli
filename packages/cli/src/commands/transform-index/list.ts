import { TransformIndexCompact } from "@metabase/client/domain/transform-index";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { transformIndexView } from "../../output/views/transform-index";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformIndexListEnvelope = listEnvelopeSchema(TransformIndexCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List a transform's target-table indexes" },
  details:
    "Returns the indexes observed in the warehouse merged with the index requests Metabase manages for the transform, so a request that has not been applied yet shows up with `present_in_warehouse: false`.",
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    transformId: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformIndexListEnvelope,
  examples: ["mb transform-index list 1", "mb transform-index list 1 --json"],
  async run({ args, ctx, getClient }) {
    const transformId = parseId(args.transformId);
    const client = await getClient();
    const { data } = await client.transformIndex.list(transformId);
    renderList(windowList(data, ctx.range), transformIndexView, ctx);
  },
});
