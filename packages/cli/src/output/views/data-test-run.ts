import { type DataTestRun, DataTestRunCompact } from "@metabase/client/domain/data-test";

import type { ResourceView } from "../view";

export const dataTestRunView: ResourceView<DataTestRun> = {
  compactPick: DataTestRunCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "test_id", label: "Test" },
    { key: "status", label: "Status" },
    { key: "start_time", label: "Started" },
    { key: "end_time", label: "Ended" },
  ],
};
