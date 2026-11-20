import { DashboardParameterConstraints } from "@metabase/client/domain/dashboard";
import { ParameterValues } from "@metabase/client/domain/parameter";
import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import { parameterValuesView } from "../../output/views/parameter";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "parameter-values",
    description: "Fetch the selectable values for a dashboard parameter",
  },
  details:
    "Returns `{ values, has_more_values }` from the chain-filter value endpoint: the parameter's static list, its source card's values, or, for a parameter mapped to a field, the field's distinct values. With `--query` the server returns only values containing the substring, ignoring case (first 1000 matches). `--constraints` sets other parameters' values, by parameter ID, which narrow the values of a parameter linked to them; an array sets several values.",
  skills: [{ skill: "dashboard", purpose: "dashboard parameters, mapping, value sources" }],
  requires: ["dashboard.parameterValues", "dashboard.searchParameterValues"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "dashboard-id": { type: "positional", description: "Dashboard id", required: true },
    "parameter-id": {
      type: "positional",
      description: "Parameter id (the parameter's id, not its slug)",
      required: true,
    },
    query: { type: "string", description: "Substring to search values for (server-side)" },
    constraints: {
      type: "string",
      description:
        'JSON object of other parameters\' values by parameter id, narrowing a linked parameter (e.g. \'{"a1b2c3":"Gizmo"}\')',
    },
  },
  outputSchema: ParameterValues,
  examples: [
    "mb dashboard parameter-values 1 order_status --json",
    "mb dashboard parameter-values 1 order_status --query Cam --json",
    'mb dashboard parameter-values 1 product_name --constraints \'{"category":["Gizmo","Widget"]}\' --json',
  ],
  async run({ args, ctx, getClient }) {
    const dashboardId = parseId(args["dashboard-id"], "dashboard-id");
    const parameterId = args["parameter-id"];
    if (parameterId === "") {
      throw new ConfigError("parameter-id must not be empty");
    }
    const constraints = parseConstraints(args.constraints);
    const client = await getClient();
    const search = args.query === undefined || args.query === "" ? null : args.query;
    const result =
      search === null
        ? await client.dashboard.parameterValues(dashboardId, parameterId, constraints)
        : await client.dashboard.searchParameterValues(
            dashboardId,
            parameterId,
            search,
            constraints,
          );
    const more = result.has_more_values ? " (more available — narrow with --query)" : "";
    renderSummary(result, parameterValuesView, `${result.values.length} value(s)${more}.`, ctx);
  },
});

function parseConstraints(raw: string | undefined): DashboardParameterConstraints {
  if (raw === undefined || raw === "") {
    return {};
  }
  return parseJson(raw, DashboardParameterConstraints, { source: "--constraints" });
}
