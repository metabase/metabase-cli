import { TransformTestCompact } from "@metabase/client/domain/transform-test";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { transformTestView } from "../../output/views/transform-test";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

export const TransformTestListEnvelope = listEnvelopeSchema(TransformTestCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform tests, optionally those of one transform" },
  requires: ["transformTest.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...preflightFlag,
    "transform-id": { type: "string", description: "Only the tests of this transform" },
  },
  outputSchema: TransformTestListEnvelope,
  examples: ["mb transform-test list", "mb transform-test list --transform-id 3 --json"],
  async run({ args, ctx, getClient }) {
    const transformId = parseOptionalInteger(args["transform-id"], {
      name: "--transform-id",
      min: 1,
    });
    const client = await getClient();
    const { data } = await client.transformTest.list({
      ...(transformId !== null && { "transform-id": transformId }),
    });
    renderList(windowList(data, ctx.range), transformTestView, ctx);
  },
});
