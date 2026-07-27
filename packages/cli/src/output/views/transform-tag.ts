import { type TransformTag, TransformTagCompact } from "@metabase/client/domain/transform-tag";

import type { ResourceView } from "../view";

export const transformTagView: ResourceView<TransformTag> = {
  compactPick: TransformTagCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "built_in_type", label: "Built-in" },
  ],
};
