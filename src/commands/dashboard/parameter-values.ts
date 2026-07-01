import { ConfigError } from "../../core/errors";
import { ParameterValues, parameterValuesView } from "../../domain/parameter";
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
    "Reads the chain-filter value endpoint. With --query the server returns only values containing the substring (first 1000 matches).",
  capabilities: { minVersion: 58 },
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
  },
  outputSchema: ParameterValues,
  examples: [
    "mb dashboard parameter-values 1 order_status --json",
    "mb dashboard parameter-values 1 order_status --query Cam --json",
  ],
  async run({ args, ctx, getClient }) {
    const dashboardId = parseId(args["dashboard-id"], "dashboard-id");
    const parameterId = args["parameter-id"];
    if (parameterId === "") {
      throw new ConfigError("parameter-id must not be empty");
    }
    const client = await getClient();
    const base = `/api/dashboard/${dashboardId}/params/${encodeURIComponent(parameterId)}`;
    const path =
      args.query === undefined || args.query === ""
        ? `${base}/values`
        : `${base}/search/${encodeURIComponent(args.query)}`;
    const result = await client.requestParsed(ParameterValues, path);
    const more = result.has_more_values ? " (more available — narrow with --query)" : "";
    renderSummary(result, parameterValuesView, `${result.values.length} value(s)${more}.`, ctx);
  },
});
