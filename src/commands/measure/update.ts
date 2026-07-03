import { Measure, MeasureUpdateInput, measureView } from "../../domain/measure";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import {
  MEASURE_DEFINITION_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a measure by id (body must include revision_message)",
  },
  details:
    "Patches only the fields you send and must include `revision_message` (recorded in the audit log). When `definition` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb query --print-schema`) before sending; pass --skip-validate to bypass.",
  skills: [{ skill: "mbql", purpose: "the definition aggregation" }],
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Measure id", required: true },
  },
  outputSchema: Measure,
  examples: [
    "cat patch.json | mb measure update 1",
    "mb measure update 1 --file patch.json",
    'mb measure update 1 --body \'{"name":"renamed","revision_message":"rename"}\'',
    "mb measure update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, MeasureUpdateInput);
    preflightMbql5Query(body.definition, MEASURE_DEFINITION_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const updated = await client.requestParsed(Measure, `/api/measure/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(updated, measureView, `Updated measure ${updated.id} "${updated.name}".`, ctx);
  },
});
