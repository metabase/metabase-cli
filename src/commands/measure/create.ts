import { Measure, MeasureCreateInput, measureView } from "../../domain/measure";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  MEASURE_DEFINITION_LABELS,
  preflightInternalMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description:
      "Create a measure from a JSON spec; if definition is MBQL 5 (lib/type: mbql/query) it is pre-flight-validated against the same schema as `metabase query` (see `metabase query --print-schema`)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  outputSchema: Measure,
  examples: [
    "cat measure.json | metabase measure create",
    "metabase measure create --file measure.json",
    "metabase measure create --file measure.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, MeasureCreateInput);
    preflightInternalMbql5Query(body.definition, MEASURE_DEFINITION_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const created = await client.requestParsed(Measure, "/api/measure", {
      method: "POST",
      body,
    });
    renderItem(created, measureView, ctx);
  },
});
