import { z } from "zod";

const WorkspaceInstanceOutput = z
  .object({
    db: z.string().nullable().optional(),
    schema: z.string().nullable().optional(),
  })
  .loose();

const WorkspaceInstanceDatabase = z
  .object({
    input_schemas: z.array(z.string()),
    output: WorkspaceInstanceOutput,
  })
  .loose();

// `databases` is keyed by database id, which JSON carries as a string.
export const WorkspaceInstance = z
  .object({
    name: z.string(),
    databases: z.record(z.string(), WorkspaceInstanceDatabase),
    can_write: z.boolean(),
  })
  .loose();
export type WorkspaceInstance = z.infer<typeof WorkspaceInstance>;

export const WorkspaceInstanceCompact = WorkspaceInstance.pick({
  name: true,
  can_write: true,
}).strip();
export type WorkspaceInstanceCompact = z.infer<typeof WorkspaceInstanceCompact>;
