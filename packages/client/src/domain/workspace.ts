import { z } from "zod";

export const WorkspaceDatabaseStatus = z.enum([
  "unprovisioned",
  "provisioning",
  "provisioned",
  "deprovisioning",
]);
export type WorkspaceDatabaseStatus = z.infer<typeof WorkspaceDatabaseStatus>;

export const WorkspaceDatabase = z
  .object({
    database_id: z.number().int(),
    input_schemas: z.array(z.string()),
    output_namespace: z.string(),
    status: WorkspaceDatabaseStatus,
  })
  .loose();
export type WorkspaceDatabase = z.infer<typeof WorkspaceDatabase>;

export const WorkspaceDatabaseCompact = WorkspaceDatabase.pick({
  database_id: true,
  status: true,
}).strip();
export type WorkspaceDatabaseCompact = z.infer<typeof WorkspaceDatabaseCompact>;

const WorkspaceCreator = z
  .object({
    id: z.number().int(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string(),
    common_name: z.string().nullable().optional(),
  })
  .loose();

export const Workspace = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    creator: WorkspaceCreator.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    databases: z.array(WorkspaceDatabase).optional(),
  })
  .loose();
export type Workspace = z.infer<typeof Workspace>;

export const WorkspaceCompact = Workspace.pick({ id: true, name: true })
  .strip()
  .extend({ databases: z.array(WorkspaceDatabaseCompact).optional() });
export type WorkspaceCompact = z.infer<typeof WorkspaceCompact>;

export const WorkspaceCreateInput = z
  .object({
    name: z.string().min(1),
    database_ids: z.array(z.number().int().positive()).min(1),
  })
  .strict();
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>;
