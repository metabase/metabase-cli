import { Field, FieldUpdateInput, fieldView } from "../../domain/field";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a field (description, semantic_type, FK target, visibility, etc.)",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Field id", required: true },
  },
  outputSchema: Field,
  examples: [
    'mb field update 100 --body \'{"description":"customer email"}\'',
    "mb field update 100 --file patch.json",
    "cat patch.json | mb field update 100",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, FieldUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Field, `/api/field/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, fieldView, ctx);
  },
});
