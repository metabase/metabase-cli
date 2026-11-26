import {
  type DataTestRun,
  DataTestRunCompact,
  type DataTestRunDetail,
  DataTestRunDetailCompact,
} from "@metabase/client/domain/data-test";

import { storedResultSummary } from "../test-run";
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

export const dataTestRunDetailView: ResourceView<DataTestRunDetail> = {
  compactPick: DataTestRunDetailCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "test_id", label: "Test" },
    { key: "status", label: "Status" },
    { key: "start_time", label: "Started" },
    { key: "end_time", label: "Ended" },
    { key: "result", label: "Result", value: storedResultSummary },
  ],
};
