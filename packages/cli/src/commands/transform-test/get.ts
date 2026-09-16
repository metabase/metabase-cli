import { TransformTest } from "@metabase/client/domain/transform-test";

import { renderItem } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform test by id" },
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform test id", required: true },
  },
  outputSchema: TransformTest,
  examples: ["mb transform-test get 1", "mb transform-test get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const transformTest = await client.transformTest.get(id);
    renderItem(transformTest, transformTestView, ctx);
  },
});
