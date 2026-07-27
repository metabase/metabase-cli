import { UploadResult, UploadUpdateResult } from "@metabase/client/domain/upload";

import type { ResourceView } from "../view";

export const uploadResultView: ResourceView<UploadResult> = {
  compactPick: UploadResult,
  tableColumns: [
    { key: "model_id", label: "Model ID" },
    { key: "table_id", label: "Table ID" },
  ],
};

export const uploadUpdateResultView: ResourceView<UploadUpdateResult> = {
  compactPick: UploadUpdateResult,
  tableColumns: [
    { key: "table_id", label: "Table ID" },
    { key: "action", label: "Action" },
  ],
};
