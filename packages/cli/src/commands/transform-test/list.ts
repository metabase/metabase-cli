import { TransformTestCompact } from "@metabase/client/domain/transform-test";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { transformTestView } from "../../output/views/transform-test";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformTestListEnvelope = listEnvelopeSchema(TransformTestCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform tests" },
  capabilities: { minVersion: 65 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    transform: { type: "string", description: "Only the tests of this transform id" },
  },
  outputSchema: TransformTestListEnvelope,
  examples: ["mb transform-test list", "mb transform-test list --transform 1 --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const transformId = args.transform === undefined ? undefined : parseId(args.transform);
    const { data } = await client.transformTest.list({ "transform-id": transformId });
    renderList(windowList(data, ctx.range), transformTestView, ctx);
  },
});
