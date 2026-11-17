import { z } from "zod";

import { dataTestBodyFields, dataTestFields, DataTestParameters } from "./data-test";

export const ActionTest = z
  .object({
    ...dataTestFields,
    action_id: z.number().int(),
    parameters: DataTestParameters,
  })
  .loose();
export type ActionTest = z.infer<typeof ActionTest>;

export const ActionTestCompact = ActionTest.pick({
  id: true,
  action_id: true,
  name: true,
  description: true,
}).strip();
export type ActionTestCompact = z.infer<typeof ActionTestCompact>;

export const ActionTestCreateInput = z
  .object({
    action_id: z.number().int().positive(),
    ...dataTestBodyFields,
    parameters: DataTestParameters,
  })
  .strict();
export type ActionTestCreateInput = z.infer<typeof ActionTestCreateInput>;

export const ActionTestUpdateInput = z
  .object({
    action_id: z.number().int().positive().optional(),
    ...z.object(dataTestBodyFields).partial().shape,
    parameters: DataTestParameters.optional(),
  })
  .strict();
export type ActionTestUpdateInput = z.infer<typeof ActionTestUpdateInput>;
