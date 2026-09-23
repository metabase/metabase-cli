import { Transform } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderItem } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform by id" },
  requires: ["transform.get"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: Transform,
  examples: ["mb transform get 1", "mb transform get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const transform = await client.transform.get(id);
    renderItem(transform, transformView, ctx);
  },
});
