import { z } from "zod";

import { dataTestBodyFields, dataTestFields } from "./data-test";

export const CardTest = z
  .object({
    ...dataTestFields,
    card_id: z.number().int(),
  })
  .loose();
export type CardTest = z.infer<typeof CardTest>;

export const CardTestCompact = CardTest.pick({
  id: true,
  card_id: true,
  name: true,
  description: true,
}).strip();
export type CardTestCompact = z.infer<typeof CardTestCompact>;

export const CardTestCreateInput = z
  .object({
    card_id: z.number().int().positive(),
    ...dataTestBodyFields,
  })
  .strict();
export type CardTestCreateInput = z.infer<typeof CardTestCreateInput>;

export const CardTestUpdateInput = z
  .object({
    card_id: z.number().int().positive().optional(),
    ...z.object(dataTestBodyFields).partial().shape,
  })
  .strict();
export type CardTestUpdateInput = z.infer<typeof CardTestUpdateInput>;
