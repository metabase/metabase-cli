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
    "A label set here is a person's call that the server's classifier never overwrites; `none` withdraws it, and the field then shows the label the classifier wrote, if it wrote one, else none. Answers the field with its `data_sensitivity`.",
  requires: ["field.setDataSensitivity"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id", required: true },
    label: {
      type: "positional",
      description: `Sensitivity label (${SensitivityArg.options.join(" | ")})`,
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
