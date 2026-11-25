import {
  DATA_SENSITIVITY_GATE,
  FieldDetail,
  hasDataSensitivity,
} from "@metabase/client/domain/field";
import { featureAvailability } from "@metabase/client/version/features";
import { fieldView, fieldWithDataSensitivityView } from "../../output/views/field";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const SENSITIVITY_FEATURE = DATA_SENSITIVITY_GATE.feature;

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a field by id" },
  details: `\`data_sensitivity\` is the field's sensitivity label (see \`mb field set-sensitivity\`), or \`null\` when it has none. On a server without \`${SENSITIVITY_FEATURE}\` (${featureAvailability(SENSITIVITY_FEATURE)}), the key and the Sensitivity column are left out.`,
  requires: ["field.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id", required: true },
  },
  outputSchema: FieldDetail,
  examples: ["mb field get 100", "mb field get 100 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const field = await client.field.get(id);
    if (hasDataSensitivity(field)) {
      renderItem(field, fieldWithDataSensitivityView, ctx);
      return;
    }
    renderItem(field, fieldView, ctx);
  },
});
