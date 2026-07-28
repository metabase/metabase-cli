import { type ParameterValues, ParameterValuesCompact } from "@metabase/client/domain/parameter";

import type { ResourceView } from "../view";

export const parameterValuesView: ResourceView<ParameterValues> = {
  compactPick: ParameterValuesCompact,
  tableColumns: [{ key: "has_more_values", label: "More available" }],
};
