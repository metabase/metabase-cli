import { z } from "zod";

import type { ResourceView } from "./view";

const WorkspaceDatabaseStatus = z.enum([
  "unprovisioned",
  "provisioning",
  "provisioned",
  "deprovisioning",
]);

const WorkspaceCreator = z
  .object({
    id: z.number().int(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string(),
    common_name: z.string().nullable().optional(),
  })
  .loose();

const WorkspaceDatabase = z
  .object({
    database_id: z.number().int(),
    input_schemas: z.array(z.string()),
    output_namespace: z.string(),
    status: WorkspaceDatabaseStatus,
    database: z.object({ id: z.number().int(), name: z.string() }).loose().nullable().optional(),
  })
  .loose();

const WorkspaceDatabaseCompact = WorkspaceDatabase.pick({
  database_id: true,
  input_schemas: true,
  output_namespace: true,
  status: true,
}).strip();

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
  created_at: true,
})
  .strip()
  .extend({ databases: z.array(WorkspaceDatabaseCompact).optional() });
export type WorkspaceCompact = z.infer<typeof WorkspaceCompact>;

export const workspaceView: ResourceView<Workspace> = {
  compactPick: WorkspaceCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "created_at", label: "Created" },
    { key: "databases", label: "Databases", format: (value) => formatDatabases(value) },
  ],
};

function formatDatabases(value: unknown): string {
  const parsed = z.array(WorkspaceDatabaseCompact).safeParse(value);
  if (!parsed.success) {
    return "";
  }
  return parsed.data.map((db) => `${db.database_id}:${db.status}`).join(", ");
}
