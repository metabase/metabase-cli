import { Field } from "@metabase/client/domain/field";
import { fieldView } from "../../output/views/field";
import { renderItem } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a field by id" },
  requires: ["field.get"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Field id", required: true },
  },
  outputSchema: Field,
  examples: ["mb field get 100", "mb field get 100 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const field = await client.field.get(id);
    renderItem(field, fieldView, ctx);
  },
});
