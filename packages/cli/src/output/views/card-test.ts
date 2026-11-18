import { type CardTest, CardTestCompact } from "@metabase/client/domain/card-test";
import { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import type { ResourceView } from "../view";

export const cardTestView: ResourceView<CardTest> = {
  compactPick: CardTestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "card_id", label: "Card" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export const cardTestRunResultView: ResourceView<TransformTestRunResult> = {
  compactPick: TransformTestRunResult,
  tableColumns: [{ key: "status", label: "Status" }],
};
