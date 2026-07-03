import { z } from "zod";

import type { ResourceView } from "../../domain/view";

export const UploadResult = z.object({
  model_id: z.number().int(),
  table_id: z.number().int(),
});
export type UploadResult = z.infer<typeof UploadResult>;

export const uploadResultView: ResourceView<UploadResult> = {
  compactPick: UploadResult,
  tableColumns: [
    { key: "model_id", label: "Model ID" },
    { key: "table_id", label: "Table ID" },
  ],
};

export const UploadUpdateAction = z.enum(["append", "replace"]);
export type UploadUpdateAction = z.infer<typeof UploadUpdateAction>;

export const UploadUpdateResult = z.object({
  table_id: z.number().int(),
  action: UploadUpdateAction,
});
export type UploadUpdateResult = z.infer<typeof UploadUpdateResult>;

export const uploadUpdateResultView: ResourceView<UploadUpdateResult> = {
  compactPick: UploadUpdateResult,
  tableColumns: [
    { key: "table_id", label: "Table ID" },
    { key: "action", label: "Action" },
  ],
};
