import { z } from "zod";

import {
  DataTestCompact,
  DataTestRunResult,
  DataTestType,
} from "@metabase/client/domain/data-test";

import type { AnyTest } from "../../core/data-test";
import type { ResourceView } from "../view";

export const anyTestView: ResourceView<AnyTest> = {
  compactPick: DataTestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

// One row per test whatever its type, with the entity it tests under one name.
export const TestListItem = z
  .object({
    test_type: DataTestType,
    id: z.number().int(),
    target_id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
  })
  .strict();
export type TestListItem = z.infer<typeof TestListItem>;

export const testListItemView: ResourceView<TestListItem> = {
  compactPick: TestListItem,
  tableColumns: [
    { key: "test_type", label: "Type" },
    { key: "id", label: "ID" },
    { key: "target_id", label: "Tests" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export const testRunResultView: ResourceView<DataTestRunResult> = {
  compactPick: DataTestRunResult,
  tableColumns: [{ key: "status", label: "Status" }],
};
