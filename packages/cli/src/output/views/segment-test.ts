import { type SegmentTest, SegmentTestCompact } from "@metabase/client/domain/segment-test";
import { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import type { ResourceView } from "../view";

export const segmentTestView: ResourceView<SegmentTest> = {
  compactPick: SegmentTestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "segment_id", label: "Segment" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export const segmentTestRunResultView: ResourceView<TransformTestRunResult> = {
  compactPick: TransformTestRunResult,
  tableColumns: [{ key: "status", label: "Status" }],
};
