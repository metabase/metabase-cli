import { z } from "zod";

import { dataTestBodyFields, dataTestFields } from "./data-test";

export const MeasureTest = z
  .object({
    ...dataTestFields,
    measure_id: z.number().int(),
  })
  .loose();
export type MeasureTest = z.infer<typeof MeasureTest>;

export const MeasureTestCompact = MeasureTest.pick({
  id: true,
  measure_id: true,
  name: true,
  description: true,
}).strip();
export type MeasureTestCompact = z.infer<typeof MeasureTestCompact>;

export const MeasureTestCreateInput = z
  .object({
    measure_id: z.number().int().positive(),
    ...dataTestBodyFields,
  })
  .strict();
export type MeasureTestCreateInput = z.infer<typeof MeasureTestCreateInput>;

export const MeasureTestUpdateInput = z
  .object({
    measure_id: z.number().int().positive().optional(),
    ...z.object(dataTestBodyFields).partial().shape,
  })
  .strict();
export type MeasureTestUpdateInput = z.infer<typeof MeasureTestUpdateInput>;
