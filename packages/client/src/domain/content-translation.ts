import { z } from "zod";

export const ContentTranslationUploadResult = z.object({
  success: z.literal(true),
});
export type ContentTranslationUploadResult = z.infer<typeof ContentTranslationUploadResult>;
