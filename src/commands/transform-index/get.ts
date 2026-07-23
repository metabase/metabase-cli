import { TransformIndexRequest, transformIndexRequestView } from "../../domain/transform-index";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform index request by id" },
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Index request id", required: true },
  },
  outputSchema: TransformIndexRequest,
  examples: ["mb transform-index get 1", "mb transform-index get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const request = await client.requestParsed(TransformIndexRequest, `/api/index/request/${id}`);
    renderItem(request, transformIndexRequestView, ctx);
  },
});
