import { z } from "zod";

// The server hydrates `creator` from its own user summary, which carries more than a worktree
// listing needs; only the id is depended on here.
const WorktreeCreator = z
  .object({
    id: z.number().int().positive(),
    email: z.email().optional(),
    common_name: z.string().optional(),
  })
  .loose();

export const Worktree = z
  .object({
    id: z.number().int().positive(),
    branch: z.string(),
    creator_id: z.number().int().positive().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    creator: WorktreeCreator.nullable().optional(),
  })
  .loose();
export type Worktree = z.infer<typeof Worktree>;

export const WorktreeCompact = Worktree.pick({
  id: true,
  branch: true,
  creator_id: true,
  created_at: true,
}).strip();
export type WorktreeCompact = z.infer<typeof WorktreeCompact>;

export const WorktreeCreateInput = z.object({
  branch: z.string().min(1),
});
export type WorktreeCreateInput = z.infer<typeof WorktreeCreateInput>;
