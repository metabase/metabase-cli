import { LintReport } from "@metabase/client/domain/lint";

import type { ResourceView } from "../view";

export const lintReportView: ResourceView<LintReport> = {
  compactPick: LintReport,
  tableColumns: [{ key: "status", label: "Status" }],
};
