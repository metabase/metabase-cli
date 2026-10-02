import { z } from "zod";

export const DATA_APP_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DataAppSlug = z
  .string()
  .regex(DATA_APP_SLUG_PATTERN, "must be dash-cased: a-z, 0-9 and single dashes");

export const DataApp = z
  .object({
    id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    version: z.number().int(),
    outdated: z.boolean(),
    bundle_path: z.string(),
    enabled: z.boolean(),
    allowed_hosts: z.array(z.string()),
    resource_collection_id: z.number().int().nullable(),
    permission_group_id: z.number().int().nullable(),
    table_ids: z.array(z.number().int()),
    has_user_permission_warnings: z.boolean().optional(),
    bundle_hash: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type DataApp = z.infer<typeof DataApp>;

// What a non-admin reads: only the fields that navigate to the app.
export const DataAppSummary = z.object({ name: z.string(), display_name: z.string() }).loose();
export type DataAppSummary = z.infer<typeof DataAppSummary>;

export const DataAppEntry = z.union([DataApp, DataAppSummary]);
export type DataAppEntry = z.infer<typeof DataAppEntry>;

export const DataAppCompact = z
  .object({
    name: z.string(),
    display_name: z.string(),
    enabled: z.boolean().optional(),
    version: z.number().int().optional(),
    outdated: z.boolean().optional(),
  })
  .strip();
export type DataAppCompact = z.infer<typeof DataAppCompact>;

export const DataAppListFilter = z.object({ available: z.boolean().optional() }).strict();
export type DataAppListFilter = z.infer<typeof DataAppListFilter>;

const DataAppFields = {
  display_name: z.string().min(1),
  description: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
  bundle_path: z.string().min(1),
  allowed_hosts: z.array(z.string()).optional(),
  bundle: z.string().min(1),
};

export const DataAppCreateInput = z.object({ name: DataAppSlug, ...DataAppFields }).strict();
export type DataAppCreateInput = z.infer<typeof DataAppCreateInput>;

export const DataAppUpdateInput = z
  .object({
    ...DataAppFields,
    display_name: DataAppFields.display_name.optional(),
    bundle_path: DataAppFields.bundle_path.optional(),
    bundle: DataAppFields.bundle.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type DataAppUpdateInput = z.infer<typeof DataAppUpdateInput>;

export const DataAppRepoStatus = z
  .object({ configured: z.boolean(), url: z.string().nullable() })
  .loose();
export type DataAppRepoStatus = z.infer<typeof DataAppRepoStatus>;

export const DataAppMissingTable = z
  .object({
    id: z.number().int(),
    name: z.string(),
    schema: z.string().nullable(),
    database_id: z.number().int(),
    database_name: z.string(),
  })
  .loose();

export const DataAppPermissionWarning = z
  .object({ user_id: z.number().int(), missing_tables: z.array(DataAppMissingTable) })
  .loose();
export type DataAppPermissionWarning = z.infer<typeof DataAppPermissionWarning>;

export const DataAppPermissionWarningsInput = z
  .object({ user_ids: z.array(z.number().int().positive()).min(1).max(100) })
  .strict();
export type DataAppPermissionWarningsInput = z.infer<typeof DataAppPermissionWarningsInput>;

/** The scope of a generated TypeScript semantic schema; a database scope excludes the library scopes. */
export const TypedSchemaScope = z
  .object({
    database: z.string().min(1).optional(),
    libraryCollections: z.array(z.string().min(1)).optional(),
    includeDataLibrary: z.boolean().optional(),
    includeMetricLibrary: z.boolean().optional(),
    includeModels: z.boolean().optional(),
  })
  .strict();
export type TypedSchemaScope = z.infer<typeof TypedSchemaScope>;
