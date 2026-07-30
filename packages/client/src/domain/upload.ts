import { z } from "zod";

// Composed rather than parsed from one payload: `POST /api/upload/csv` answers the model id as a
// bare integer body and puts the table id in a response header.
export const UploadResult = z.object({
  model_id: z.number().int(),
  table_id: z.number().int(),
});
export type UploadResult = z.infer<typeof UploadResult>;

export const UploadUpdateAction = z.enum(["append", "replace"]);
export type UploadUpdateAction = z.infer<typeof UploadUpdateAction>;

// The append/replace endpoints answer no useful body, so the confirmation is the request restated.
export const UploadUpdateResult = z.object({
  table_id: z.number().int(),
  action: UploadUpdateAction,
});
export type UploadUpdateResult = z.infer<typeof UploadUpdateResult>;
