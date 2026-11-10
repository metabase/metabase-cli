import { z } from "zod";

import { gateInput } from "../version/input-gate-registry";
import type { InputGate } from "../version/input-gates";

const DATA_APP_SLUG_MAX_LENGTH = 100;

// Metabase routes these under `/api/ee/apps/`, so an app with one would be unreachable.
const RESERVED_DATA_APP_SLUGS: ReadonlySet<string> = new Set(["repo-status", "generate"]);

export const DataAppSlug = z
  .string()
  .max(DATA_APP_SLUG_MAX_LENGTH, `must be at most ${DATA_APP_SLUG_MAX_LENGTH} characters`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be dash-cased: a-z, 0-9 and single dashes")
  .refine((slug) => !RESERVED_DATA_APP_SLUGS.has(slug), "is reserved by Metabase");

export const DataApp = z
  .object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
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
export const DataAppSummary = z
  .object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    outdated: z.boolean(),
  })
  .strict();
export type DataAppSummary = z.infer<typeof DataAppSummary>;

export const DataAppEntry = z.union([DataApp, DataAppSummary]);
export type DataAppEntry = z.infer<typeof DataAppEntry>;

// A summary carries no collection, so the admin-only field is optional here.
export const DataAppCompact = DataApp.pick({
  id: true,
  slug: true,
  name: true,
  enabled: true,
  resource_collection_id: true,
  outdated: true,
})
  .strip()
  .partial({ resource_collection_id: true });
export type DataAppCompact = z.infer<typeof DataAppCompact>;

const DataAppFields = {
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
  bundle_path: z.string().min(1).optional(),
  allowed_hosts: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
};

export const DataAppCreateInput = z.object({ slug: DataAppSlug, ...DataAppFields }).strict();
export type DataAppCreateInput = z.infer<typeof DataAppCreateInput>;

export const DATA_APP_EDITING_GATE: InputGate = {
  feature: "dataAppEditing",
  effect: "needs",
  when: { kind: "present" },
};

// Before `dataAppEditing` an update takes `enabled` alone.
export const DataAppUpdateInput = z
  .object({
    name: gateInput(DataAppFields.name, DATA_APP_EDITING_GATE),
    description: gateInput(DataAppFields.description, DATA_APP_EDITING_GATE),
    version: gateInput(DataAppFields.version, DATA_APP_EDITING_GATE),
    bundle_path: gateInput(DataAppFields.bundle_path, DATA_APP_EDITING_GATE),
    allowed_hosts: gateInput(DataAppFields.allowed_hosts, DATA_APP_EDITING_GATE),
    enabled: DataAppFields.enabled,
  })
  .strict();
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
