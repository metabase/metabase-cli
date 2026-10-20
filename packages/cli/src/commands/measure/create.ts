import { Measure, MeasureCreateInput } from "@metabase/client/domain/measure";
import { measureView } from "../../output/views/measure";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { MEASURE_DEFINITION, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a measure (saved aggregation) from JSON",
  },
  details:
    "A measure is a reusable, saved aggregation tied to a table. The JSON body needs `name`, `table_id`, and a `definition` (an MBQL query holding exactly one aggregation). An MBQL 5 `definition` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.",
  skills: [{ skill: "mbql", purpose: "the definition aggregation" }],
  requires: ["measure.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: MeasureCreateInput,
  embeddedDocuments: [MEASURE_DEFINITION],
  outputSchema: Measure,
  examples: [
    "cat measure.json | mb measure create",
    "mb measure create --file measure.json",
    "mb measure create --file measure.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.measure.create(body);
    renderSummary(created, measureView, `Created measure ${created.id} "${created.name}".`, ctx);
  },
});
