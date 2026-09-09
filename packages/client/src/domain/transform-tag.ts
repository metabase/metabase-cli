import { z } from "zod";

export const TransformTag = z
  .object({
    id: z.number().int(),
    name: z.string(),
    entity_id: z.string().nullable(),
    built_in_type: z.string().nullable(),
    worktree_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type TransformTag = z.infer<typeof TransformTag>;

export const TransformTagCompact = TransformTag.pick({
  id: true,
  name: true,
  built_in_type: true,
  worktree_id: true,
}).strip();
export type TransformTagCompact = z.infer<typeof TransformTagCompact>;

export const TransformTagCreateInput = z
  .object({
    name: z.string().min(1),
    worktree_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type TransformTagCreateInput = z.infer<typeof TransformTagCreateInput>;

export const TransformTagUpdateInput = z
  .object({
    name: z.string().min(1),
  })
  .loose();
export type TransformTagUpdateInput = z.infer<typeof TransformTagUpdateInput>;
