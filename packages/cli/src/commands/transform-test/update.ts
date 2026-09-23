import { TransformTest, TransformTestUpdateInput } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform test by id" },
  details:
    "Omitted fields keep their value. A body that touches the transform, inputs or expectations is validated as on create, with the same refusal.",
  requires: ["transformTest.update"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform test id", required: true },
  },
  inputSchema: TransformTestUpdateInput,
  outputSchema: TransformTest,
  examples: [
    'mb transform-test update 5 --body \'{"name":"renamed"}\'',
    "mb transform-test update 5 --file test.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformTestUpdateInput);
    const client = await getClient();
    const updated = await client.transformTest.update(id, body);
    renderSummary(
      updated,
      transformTestView,
      `Updated transform test ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
