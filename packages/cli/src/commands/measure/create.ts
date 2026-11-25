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
    "A measure is a saved aggregation on a table, which cards and metrics reuse. The JSON body needs `name`, `table_id` and a `definition` (an MBQL query with exactly one aggregation).",
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
