import {
  TransformIndexRequest,
  TransformIndexUpdateInput,
  transformIndexRequestView,
} from "../../domain/transform-index";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Replace an index request's definition by id" },
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Index request id", required: true },
  },
  inputSchema: TransformIndexUpdateInput,
  outputSchema: TransformIndexRequest,
  examples: [
    'mb transform-index update 1 --body \'{"structured":{"kind":"btree","name":"idx_id","columns":[{"name":"id"},{"name":"created_at"}]}}\'',
    "mb transform-index update 1 --file index.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformIndexUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(TransformIndexRequest, `/api/index/request/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(
      updated,
      transformIndexRequestView,
      `Updated index request ${updated.id} "${updated.index_name}".`,
      ctx,
    );
  },
});
