import { FieldDetail, FieldUpdateInput, hasDataSensitivity } from "@metabase/client/domain/field";
import { fieldView, fieldWithDataSensitivityView } from "../../output/views/field";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a field (description, semantic_type, FK target, visibility, etc.)",
  },
  details:
    "A `data_sensitivity` key (a label, or `null` to withdraw one; see `mb field set-sensitivity`) is refused before the request on a server older than Metabase 64 (exit 2), because such a server drops the key without a word.",
  requires: ["field.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Field id", required: true },
  },
  inputSchema: FieldUpdateInput,
  outputSchema: FieldDetail,
  examples: [
    'mb field update 100 --body \'{"description":"customer email","semantic_type":"type/Email"}\'',
    "mb field update 100 --file patch.json",
    "cat patch.json | mb field update 100",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.field.update(id, body);
    const summary = `Updated field ${updated.id} "${updated.display_name}".`;
    if (hasDataSensitivity(updated)) {
      renderSummary(updated, fieldWithDataSensitivityView, summary, ctx);
      return;
    }
    renderSummary(updated, fieldView, summary, ctx);
  },
});
