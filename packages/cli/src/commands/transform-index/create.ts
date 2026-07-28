import {
  TransformIndexCreateInput,
  TransformIndexRequest,
} from "@metabase/client/domain/transform-index";

import { renderSummary } from "../../output/render";
import { transformIndexRequestView } from "../../output/views/transform-index";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create an index request on a transform's target table" },
  details:
    "Body keys: `transform_id` and `structured`, a definition dispatched on `kind` (`btree`, `hash`, `sortkey`, `distkey`, `clustering`, `order-by`, `skip-index`, …). The request lands pending — the physical index is created the next time the target table is rebuilt in full.",
  capabilities: { minVersion: 64 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  inputSchema: TransformIndexCreateInput,
  outputSchema: TransformIndexRequest,
  examples: [
    'mb transform-index create --body \'{"transform_id":1,"structured":{"kind":"btree","name":"idx_id","columns":[{"name":"id"}]}}\'',
    "mb transform-index create --file index.json",
    'echo \'{"transform_id":1,"structured":{"kind":"btree","name":"idx_id","columns":[{"name":"id"}]}}\' | mb transform-index create',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformIndexCreateInput);
    const client = await getClient();
    const created = await client.transformIndex.create(body);
    renderSummary(
      created,
      transformIndexRequestView,
      `Created index request ${created.id} "${created.index_name}".`,
      ctx,
    );
  },
});
