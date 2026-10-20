import { z } from "zod";

// What every data app endpoint answers an administrator: the app as the instance holds it, with
// whether it targets an older contract version than the instance serves.
export const DataApp = z
  .object({
    id: z.number().int(),
    // The slug the app is served at, under `/apps/`.
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    version: z.number().int(),
    outdated: z.boolean(),
    bundle_path: z.string(),
    enabled: z.boolean(),
    allowed_hosts: z.array(z.string()),
    resource_collection_id: z.number().int(),
    table_ids: z.array(z.number().int()),
    bundle_hash: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type DataApp = z.infer<typeof DataApp>;

export const DataAppCompact = DataApp.pick({
  id: true,
  name: true,
  display_name: true,
  version: true,
  outdated: true,
  enabled: true,
  resource_collection_id: true,
}).strip();
export type DataAppCompact = z.infer<typeof DataAppCompact>;

// What the same endpoints answer anyone but an administrator: only what navigation needs.
export const DataAppEntry = z.object({ name: z.string(), display_name: z.string() }).loose();
export type DataAppEntry = z.infer<typeof DataAppEntry>;

export const DataAppListing = z.union([DataApp, DataAppEntry]);
export type DataAppListing = z.infer<typeof DataAppListing>;

export const DataAppGenerateInput = z
  .object({
    // The display name; the slug is made from it when `slug` is absent.
    name: z.string().min(1),
    slug: z.string().min(1).nullable().optional(),
    description: z.string().max(255).optional(),
  })
  .strict();
export type DataAppGenerateInput = z.infer<typeof DataAppGenerateInput>;

// A file a remote-sync export would write, at its path from the repository's top.
export const DataAppFile = z.object({ path: z.string(), yaml: z.string() }).loose();
export type DataAppFile = z.infer<typeof DataAppFile>;

export const DataAppFiles = z.object({ files: z.array(DataAppFile) }).loose();
export type DataAppFiles = z.infer<typeof DataAppFiles>;

export const DataAppResourceQueryInput = z
  .object({
    name: z.string().min(1),
    query: z.unknown(),
    entity_id: z.string().min(1),
    collection_id: z.string().min(1),
  })
  .strict();
export type DataAppResourceQueryInput = z.infer<typeof DataAppResourceQueryInput>;

export const DataAppResourceActionInput = z
  .object({
    action_id: z.number().int().positive(),
    entity_id: z.string().min(1),
    collection_id: z.string().min(1),
  })
  .strict();
export type DataAppResourceActionInput = z.infer<typeof DataAppResourceActionInput>;

export const DataAppResourcesInput = z
  .object({
    queries: z.array(DataAppResourceQueryInput).optional(),
    actions: z.array(DataAppResourceActionInput).optional(),
  })
  .strict();
export type DataAppResourcesInput = z.infer<typeof DataAppResourcesInput>;

// A file in the folder of the app's collection, named within that folder, or why it could not be made.
export const DataAppResourceWritten = z.object({ file: z.string(), yaml: z.string() }).loose();
export type DataAppResourceWritten = z.infer<typeof DataAppResourceWritten>;

export const DataAppResourceRefused = z.object({ error: z.string() }).loose();
export type DataAppResourceRefused = z.infer<typeof DataAppResourceRefused>;

export const DataAppResourceFile = z.union([DataAppResourceWritten, DataAppResourceRefused]);
export type DataAppResourceFile = z.infer<typeof DataAppResourceFile>;

export const DataAppResources = z
  .object({
    queries: z.array(DataAppResourceFile),
    actions: z.array(DataAppResourceFile),
    metrics: z.array(DataAppResourceFile),
  })
  .loose();
export type DataAppResources = z.infer<typeof DataAppResources>;

export const DataAppGroup = z
  .object({ id: z.number().int(), name: z.string(), member_count: z.number().int() })
  .loose();
export type DataAppGroup = z.infer<typeof DataAppGroup>;

export const DataAppMissingTable = z
  .object({
    id: z.number().int(),
    name: z.string(),
    schema: z.string().nullable(),
    database_id: z.number().int(),
    database_name: z.string(),
  })
  .loose();
export type DataAppMissingTable = z.infer<typeof DataAppMissingTable>;

export const DataAppGroupWarning = z
  .object({ group_id: z.number().int(), missing_tables: z.array(DataAppMissingTable) })
  .loose();
export type DataAppGroupWarning = z.infer<typeof DataAppGroupWarning>;
