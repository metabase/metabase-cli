import { z } from "zod";

import type { ResourceView } from "./view";

const WorkspaceDatabaseStatus = z.enum([
  "unprovisioned",
  "provisioning",
  "provisioned",
  "deprovisioning",
]);

export const WorkspaceDatabase = z
  .object({
    database_id: z.number().int(),
    output_schema: z.string(),
    input_schemas: z.array(z.string()),
    status: WorkspaceDatabaseStatus,
  })
  .loose();
export type WorkspaceDatabase = z.infer<typeof WorkspaceDatabase>;

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
    id: z.number().int(),
    name: z.string(),
    creator: WorkspaceCreator.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    databases: z.array(WorkspaceDatabase).optional(),
  })
  .loose();
export type Workspace = z.infer<typeof Workspace>;

export const WorkspaceCompact = Workspace.pick({
  id: true,
  name: true,
  databases: true,
}).strip();
export type WorkspaceCompact = z.infer<typeof WorkspaceCompact>;

const WorkspaceDatabaseList = z.array(WorkspaceDatabase);

export const workspaceView: ResourceView<Workspace> = {
  compactPick: WorkspaceCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    {
      key: "databases",
      label: "Databases",
      format: (value) => formatDatabases(value),
    },
  ],
};

export const WorkspaceCreateInput = z
  .object({
    name: z.string().min(1),
  })
  .loose();
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>;

export const WorkspaceProvisionInput = z
  .object({
    database_id: z.number().int().positive(),
    input_schemas: z.array(z.string().min(1)).min(1),
  })
  .loose();
export type WorkspaceProvisionInput = z.infer<typeof WorkspaceProvisionInput>;

export const WorkspaceUpdateDatabaseInput = z
  .object({
    input_schemas: z.array(z.string().min(1)).min(1),
  })
  .loose();
export type WorkspaceUpdateDatabaseInput = z.infer<typeof WorkspaceUpdateDatabaseInput>;

function formatDatabases(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  const parsed = WorkspaceDatabaseList.safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    return "(none)";
  }
  return parsed.data
    .map((entry) => {
      const schemaList =
        entry.input_schemas.length === 0 ? "" : ` [${entry.input_schemas.join(", ")}]`;
      return `${entry.database_id} (${entry.status})${schemaList}`;
    })
    .join("; ");
}
