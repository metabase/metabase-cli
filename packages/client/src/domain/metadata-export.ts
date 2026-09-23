import { z } from "zod";

// The warehouse metadata export: three flat arrays keyed by numeric ids. Optional fields are
// omitted by the server rather than sent as `null`, so the file reads back exactly as written.
export const MetadataExportDatabase = z
  .object({
    id: z.number().int(),
    name: z.string(),
    engine: z.string(),
  })
  .loose();
export type MetadataExportDatabase = z.infer<typeof MetadataExportDatabase>;

export const MetadataExportTable = z
  .object({
    id: z.number().int(),
    db_id: z.number().int(),
    name: z.string(),
    schema: z.string().nullable(),
    description: z.string().optional(),
  })
  .loose();
export type MetadataExportTable = z.infer<typeof MetadataExportTable>;

export const MetadataExportField = z
  .object({
    id: z.number().int(),
    table_id: z.number().int(),
    name: z.string(),
    description: z.string().optional(),
    base_type: z.string().optional(),
    database_type: z.string().optional(),
    semantic_type: z.string().optional(),
    effective_type: z.string().optional(),
    coercion_strategy: z.string().optional(),
    parent_id: z.number().int().nullable().optional(),
    fk_target_field_id: z.number().int().nullable().optional(),
  })
  .loose();
export type MetadataExportField = z.infer<typeof MetadataExportField>;

export const MetadataExport = z
  .object({
    databases: z.array(MetadataExportDatabase),
    tables: z.array(MetadataExportTable),
    fields: z.array(MetadataExportField),
  })
  .loose();
export type MetadataExport = z.infer<typeof MetadataExport>;
