import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ParameterValues } from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, type TextToolResult } from "./tool-result";

const TARGETS = ["dashboard", "question"] as const;
type Target = (typeof TARGETS)[number];

const parameters = Type.Object({
  target: Type.Unsafe<Target>({
    type: "string",
    enum: [...TARGETS],
    description: "Whether the parameter belongs to a `dashboard` or a `question`.",
  }),
  id: Type.Integer({ description: "Dashboard or question id." }),
  parameter_id: Type.String({
    description: "The parameter's id (the `id` field on the entity's parameters).",
  }),
  query: Type.Optional(
    Type.String({ description: "Prefix filter — returns only values containing this string." }),
  ),
  constraints: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
      description:
        "dashboard only: other parameter selections that chain-filter these values, keyed by parameter id.",
    }),
  ),
});

export function getParameterValuesTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "get_parameter_values",
    label: "Get parameter values",
    description:
      'Fetch valid values for a dashboard or question filter so you can fill it before running. `query` narrows to values containing a substring; `constraints` (dashboards only) chain-filters given other filter selections. Returns `{values, has_more_values}` verbatim.\n\nExamples: `{target: "dashboard", id: 3, parameter_id: "abc"}` · `{target: "question", id: 5, parameter_id: "cat", query: "Gi"}`',
    parameters,
    execute: (_id, params) => runGetParameterValuesTool(deps, params),
  });
}

type GetParameterValuesToolParams = Static<typeof parameters>;

export function runGetParameterValuesTool(
  deps: MetabaseToolDeps,
  params: GetParameterValuesToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const constraints = params.constraints ?? {};
    if (params.target === "question" && Object.keys(constraints).length > 0) {
      throw new TeachingError(
        '`constraints` is only supported for dashboard parameters — the question values endpoint takes none. Drop `constraints` or set `target: "dashboard"`.',
      );
    }
    const base =
      params.target === "dashboard" ? `/api/dashboard/${params.id}` : `/api/card/${params.id}`;
    const key = encodeURIComponent(params.parameter_id);
    const path =
      params.query !== undefined && params.query !== ""
        ? `${base}/params/${key}/search/${encodeURIComponent(params.query)}`
        : `${base}/params/${key}/values`;
    const values = await deps.client.requestParsed(ParameterValues, path, { query: constraints });
    return jsonResult(`${values.values.length} values for ${params.parameter_id}`, values);
  });
}
