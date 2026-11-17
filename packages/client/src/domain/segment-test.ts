import { z } from "zod";

import { dataTestBodyFields, dataTestFields } from "./data-test";

export const SegmentTest = z
  .object({
    ...dataTestFields,
    segment_id: z.number().int(),
  })
  .loose();
export type SegmentTest = z.infer<typeof SegmentTest>;

export const SegmentTestCompact = SegmentTest.pick({
  id: true,
  segment_id: true,
  name: true,
  description: true,
}).strip();
export type SegmentTestCompact = z.infer<typeof SegmentTestCompact>;

export const SegmentTestCreateInput = z
  .object({
    segment_id: z.number().int().positive(),
    ...dataTestBodyFields,
  })
  .strict();
export type SegmentTestCreateInput = z.infer<typeof SegmentTestCreateInput>;

export const SegmentTestUpdateInput = SegmentTestCreateInput.partial().strict();
export type SegmentTestUpdateInput = z.infer<typeof SegmentTestUpdateInput>;
