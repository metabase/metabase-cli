import { type TransformTest, TransformTestCompact } from "@metabase/client/domain/transform-test";

import type { ResourceView } from "../view";

export const transformTestView: ResourceView<TransformTest> = {
  compactPick: TransformTestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "transform_id", label: "Transform" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};
