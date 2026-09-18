import { TransformTest, TransformTestUpdateInput } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform test from JSON" },
  details:
    "Only the fields the body carries are patched. `inputs` and `expectations` replace what is stored rather than merging into it. The body is closed: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it can be sent.",
  capabilities: { minVersion: 65 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform test id", required: true },
  },
  inputSchema: TransformTestUpdateInput,
  outputSchema: TransformTest,
  examples: [
    "cat patch.json | mb transform-test update 1",
    "mb transform-test update 1 --file patch.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformTestUpdateInput);
    const client = await getClient();
    const updated = await client.transformTest.update(id, body);
    renderSummary(updated, transformTestView, `Updated transform test ${updated.id}.`, ctx);
  },
});
