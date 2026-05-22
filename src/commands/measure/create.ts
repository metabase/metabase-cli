import { Measure, MeasureCreateInput, measureView } from "../../domain/measure";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  MEASURE_DEFINITION_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a measure (saved aggregation) from JSON",
  },
  details:
    "A measure is a reusable, saved aggregation tied to a table. The JSON body needs `name`, `table_id`, and a `definition` (an MBQL query holding exactly one aggregation). An MBQL 5 `definition` is checked against a bundled JSON Schema before sending; pass --skip-validate to bypass. See `mb skills get mbql`.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  outputSchema: Measure,
  examples: [
    "cat measure.json | mb measure create",
    "mb measure create --file measure.json",
    "mb measure create --file measure.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, MeasureCreateInput);
    preflightMbql5Query(body.definition, MEASURE_DEFINITION_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const created = await client.requestParsed(Measure, "/api/measure", {
      method: "POST",
      body,
    });
    renderSummary(created, measureView, `Created measure ${created.id} "${created.name}".`, ctx);
  },
});
