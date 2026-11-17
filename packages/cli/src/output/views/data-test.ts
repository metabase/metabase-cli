import { z } from "zod";

import { ActionTest } from "@metabase/client/domain/action-test";
import { CardTest } from "@metabase/client/domain/card-test";
import { dataTestFields, DataTestType } from "@metabase/client/domain/data-test";
import { MeasureTest } from "@metabase/client/domain/measure-test";
import { SegmentTest } from "@metabase/client/domain/segment-test";
import { TransformTest } from "@metabase/client/domain/transform-test";

import type { ResourceView } from "../view";

export const AnyTest = z.union([TransformTest, CardTest, SegmentTest, MeasureTest, ActionTest]);
export type AnyTest = z.infer<typeof AnyTest>;

// Only the fields every test type shares, so a compact test reads the same whatever its type.
const AnyTestCompact = z
  .object(dataTestFields)
  .pick({ id: true, name: true, description: true })
  .strip();

export const anyTestView: ResourceView<AnyTest> = {
  compactPick: AnyTestCompact,
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
