import { z } from "zod";

import { TransformTestExpectation, TransformTestInput } from "./transform-test";

export const SegmentTest = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    segment_id: z.number().int(),
    creator_id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
    created_at: z.string(),
    updated_at: z.string(),
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
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
  })
  .strict();
export type SegmentTestCreateInput = z.infer<typeof SegmentTestCreateInput>;

export const SegmentTestUpdateInput = z
  .object({
    segment_id: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput).optional(),
    expectations: z.array(TransformTestExpectation).optional(),
  })
  .strict();
export type SegmentTestUpdateInput = z.infer<typeof SegmentTestUpdateInput>;
