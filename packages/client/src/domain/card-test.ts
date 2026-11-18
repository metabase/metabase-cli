import { z } from "zod";

import { TransformTestExpectation, TransformTestInput } from "./transform-test";

export const CardTest = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    card_id: z.number().int(),
    creator_id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
    created_at: z.string(),
    updated_at: z.string(),
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
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
  })
  .strict();
export type CardTestCreateInput = z.infer<typeof CardTestCreateInput>;

export const CardTestUpdateInput = z
  .object({
    card_id: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput).optional(),
    expectations: z.array(TransformTestExpectation).optional(),
  })
  .strict();
export type CardTestUpdateInput = z.infer<typeof CardTestUpdateInput>;
