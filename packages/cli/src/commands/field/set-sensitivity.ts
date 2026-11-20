import { z } from "zod";

import { FieldDataSensitivity, FieldWithDataSensitivity } from "@metabase/client/domain/field";

import { renderSummary } from "../../output/render";
import { fieldWithDataSensitivityView } from "../../output/views/field";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const NONE = "none";

const SensitivityArg = z.enum([...FieldDataSensitivity.options, NONE]);

function parseSensitivity(value: string): FieldDataSensitivity | null {
  const parsed = parseEnumFlag(value, SensitivityArg, "label");
  return parsed === NONE ? null : parsed;
}

function summarize(
  field: FieldWithDataSensitivity,
  sensitivity: FieldDataSensitivity | null,
): string {
  if (sensitivity !== null) {
    return `Labelled field ${field.id} "${field.display_name}" as ${sensitivity}.`;
  }
  const unset = `Field ${field.id} "${field.display_name}" carries no hand-set label`;
  if (field.data_sensitivity === null) {
    return `${unset} and is unlabelled.`;
  }
  return `${unset} and shows the classifier's ${field.data_sensitivity}.`;
}

export default defineMetabaseCommand({
  meta: {
    name: "set-sensitivity",
    description: "Label a field's data sensitivity by hand, or withdraw the label with `none`",
  },
  details:
    "The server's classifier never overwrites a label you set here. `none` withdraws your label, and the field then shows the classifier's label, if it wrote one. Returns the field with its `data_sensitivity`, which `mb field get <id>` reads back. Refused before the request (exit 2) on a server without `fieldDataSensitivity`.",
  requires: ["field.setDataSensitivity"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id", required: true },
    label: {
      type: "positional",
      description: `Sensitivity label, most severe first (${FieldDataSensitivity.options.join(" | ")}), or ${NONE} to withdraw it`,
      required: true,
    },
  },
  outputSchema: FieldWithDataSensitivity,
  examples: [
    "mb field set-sensitivity 100 PII",
    "mb field set-sensitivity 100 none",
    "mb field set-sensitivity 100 PHI --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const sensitivity = parseSensitivity(args.label);
    const client = await getClient();
    const field = await client.field.setDataSensitivity(id, { data_sensitivity: sensitivity });
    renderSummary(field, fieldWithDataSensitivityView, summarize(field, sensitivity), ctx);
  },
});
