import { z } from "zod";

const DATA_APP_SLUG_MAX_LENGTH = 100;

// Metabase routes these under `/api/ee/apps/`, so an app with one would be unreachable.
const RESERVED_DATA_APP_SLUGS: ReadonlySet<string> = new Set(["repo-status", "sandbox-host"]);

export const DataAppSlug = z
  .string()
  .max(DATA_APP_SLUG_MAX_LENGTH, `must be at most ${DATA_APP_SLUG_MAX_LENGTH} characters`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be dash-cased: a-z, 0-9 and single dashes")
  .refine((slug) => !RESERVED_DATA_APP_SLUGS.has(slug), "is reserved by Metabase");

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
    resource_collection_id: z.number().int(),
    bundle_hash: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type DataApp = z.infer<typeof DataApp>;

// What a non-admin reads: only the fields that navigate to the app. Strict, so an admin answer
// `DataApp` rejects fails here too instead of passing as a summary.
export const DataAppSummary = z.object({ name: z.string(), display_name: z.string() }).strict();
export type DataAppSummary = z.infer<typeof DataAppSummary>;

export const DataAppEntry = z.union([DataApp, DataAppSummary]);
export type DataAppEntry = z.infer<typeof DataAppEntry>;

// A summary carries only `name` and `display_name`, so the admin-only fields are optional here.
export const DataAppCompact = DataApp.pick({
  name: true,
  display_name: true,
  enabled: true,
  resource_collection_id: true,
  outdated: true,
})
  .strip()
  .partial({ enabled: true, resource_collection_id: true, outdated: true });
export type DataAppCompact = z.infer<typeof DataAppCompact>;

export const DataAppUpdateInput = z.object({ enabled: z.boolean() }).strict();
export type DataAppUpdateInput = z.infer<typeof DataAppUpdateInput>;

export const DataAppGeneratedFile = z.object({ path: z.string(), contents: z.string() }).strict();
export type DataAppGeneratedFile = z.infer<typeof DataAppGeneratedFile>;

export const DataAppGeneratedFiles = z.array(DataAppGeneratedFile);
export type DataAppGeneratedFiles = z.infer<typeof DataAppGeneratedFiles>;

// A `defineQuery` definition is Metabase's to read: the request carries it as the one stage of a query.
export const DataAppQueryDefinition = z
  .object({
    entityId: z.string(),
    query: z.object({ stages: z.tuple([z.object({}).loose()]) }).strict(),
  })
  .strict();
export type DataAppQueryDefinition = z.infer<typeof DataAppQueryDefinition>;

export const DataAppActionDefinition = z
  .object({
    entityId: z.string(),
    kind: z.enum(["row/create", "row/update", "row/delete"]),
    table: z.object({ id: z.number().int() }).loose(),
  })
  .strict();
export type DataAppActionDefinition = z.infer<typeof DataAppActionDefinition>;

export const DataAppGenerateQueriesInput = z
  .object({ collection: z.string(), queries: z.record(z.string(), DataAppQueryDefinition) })
  .strict();
export type DataAppGenerateQueriesInput = z.infer<typeof DataAppGenerateQueriesInput>;

export const DataAppGenerateActionsInput = z
  .object({ collection: z.string(), actions: z.record(z.string(), DataAppActionDefinition) })
  .strict();
export type DataAppGenerateActionsInput = z.infer<typeof DataAppGenerateActionsInput>;
