import { z } from "zod";

// A remote-sync worktree: a checkout of one branch that lives beside the main app's content, which
// a request enters by naming its id.
export const Worktree = z
  .object({
    id: z.number().int().positive(),
    branch: z.string(),
    creator_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type Worktree = z.infer<typeof Worktree>;

export const WorktreeCompact = Worktree.pick({ id: true, branch: true }).strip();
export type WorktreeCompact = z.infer<typeof WorktreeCompact>;
