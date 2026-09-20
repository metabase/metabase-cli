import { z } from "zod";

import { CardType } from "./card";
import { CollectionAuthorityLevel, CollectionId } from "./collection";

export const DependencyType = z.enum([
  "table",
  "card",
  "snippet",
  "transform",
  "dashboard",
  "document",
  "sandbox",
  "segment",
  "measure",
]);
export type DependencyType = z.infer<typeof DependencyType>;

export const DependencyUsageType = z.enum([
  "table",
  "snippet",
  "transform",
  "dashboard",
  "document",
  "sandbox",
  "segment",
  "question",
  "model",
  "metric",
  "measure",
]);
export type DependencyUsageType = z.infer<typeof DependencyUsageType>;

export const DependencyFindingErrorType = z.enum([
  "missing-column",
  "missing-table-alias",
  "missing-table",
  "missing-card",
  "duplicate-column",
  "syntax-error",
  "validation-exception-error",
]);
export type DependencyFindingErrorType = z.infer<typeof DependencyFindingErrorType>;

export const DependencyErrorSourceType = z.enum(["table", "card", "transform"]);
export type DependencyErrorSourceType = z.infer<typeof DependencyErrorSourceType>;

export const DependentsSortColumn = z.enum(["name", "location", "view-count"]);
export type DependentsSortColumn = z.infer<typeof DependentsSortColumn>;

export const DependencyItemsSortColumn = z.enum([
  "name",
  "location",
  "dependents-with-errors",
  "dependents-errors",
]);
export type DependencyItemsSortColumn = z.infer<typeof DependencyItemsSortColumn>;

// A card's, dashboard's or document's collection is hydrated with `is_personal`; a snippet's or a
// transform's is not, so the key is absent there on every server.
const DependencyCollectionRef = z
  .object({
    id: CollectionId,
    name: z.string(),
    authority_level: CollectionAuthorityLevel.nullable(),
    is_personal: z.boolean().optional(),
  })
  .loose();

const DependencyContainerRef = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .loose();

const DependencyDatabaseRef = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .loose();

// A segment's, measure's or sandbox's table: a whole hydrated table. A transform's `table` is
// always null, since the server hydrates it from target columns it does not select.
const DependencyTableRef = z
  .object({
    id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
  })
  .loose();

// The wire carries a per-type subset of these keys on every server: a table names a schema and a
// database, a card a collection and a card type, and none of the nine types sends every key.
export const DependencyEntityData = z
  .object({
    name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: CardType.nullable().optional(),
    display: z.string().nullable().optional(),
    database_id: z.number().int().nullable().optional(),
    db_id: z.number().int().nullable().optional(),
    schema: z.string().nullable().optional(),
    collection_id: CollectionId.nullable().optional(),
    collection: DependencyCollectionRef.nullable().optional(),
    dashboard_id: z.number().int().nullable().optional(),
    dashboard: DependencyContainerRef.nullable().optional(),
    document_id: z.number().int().nullable().optional(),
    document: DependencyContainerRef.nullable().optional(),
    db: DependencyDatabaseRef.nullable().optional(),
    table_id: z.number().int().nullable().optional(),
    table: DependencyTableRef.nullable().optional(),
    view_count: z.number().int().nullable().optional(),
  })
  .loose();
export type DependencyEntityData = z.infer<typeof DependencyEntityData>;

export const DependencyEntity = z
  .object({
    id: z.number().int(),
    type: DependencyType,
    data: DependencyEntityData,
  })
  .loose();
export type DependencyEntity = z.infer<typeof DependencyEntity>;

const DependencyEntityDataCompact = DependencyEntityData.pick({
  name: true,
  display_name: true,
  description: true,
  type: true,
  database_id: true,
  db_id: true,
  schema: true,
  table_id: true,
  collection_id: true,
  dashboard_id: true,
  document_id: true,
  view_count: true,
})
  .strip()
  .extend({
    db: DependencyDatabaseRef.pick({ id: true, name: true }).strip().nullable().optional(),
    table: DependencyTableRef.pick({ id: true, name: true, display_name: true })
      .strip()
      .nullable()
      .optional(),
    collection: DependencyCollectionRef.pick({
      id: true,
      name: true,
      authority_level: true,
      is_personal: true,
    })
      .strip()
      .nullable()
      .optional(),
    dashboard: DependencyContainerRef.pick({ id: true, name: true }).strip().nullable().optional(),
    document: DependencyContainerRef.pick({ id: true, name: true }).strip().nullable().optional(),
  });

export const DependencyEntityCompact = DependencyEntity.pick({ id: true, type: true })
  .strip()
  .extend({ data: DependencyEntityDataCompact });
export type DependencyEntityCompact = z.infer<typeof DependencyEntityCompact>;

export const DependencyNode = DependencyEntity.extend({
  dependents_count: z.partialRecord(DependencyUsageType, z.number().int()).nullable(),
});
export type DependencyNode = z.infer<typeof DependencyNode>;

export const DependencyNodeCompact = DependencyEntityCompact.extend({
  dependents_count: DependencyNode.shape.dependents_count,
});
export type DependencyNodeCompact = z.infer<typeof DependencyNodeCompact>;

export const DependencyFindingError = z
  .object({
    id: z.number().int(),
    analyzed_entity_type: DependencyType,
    analyzed_entity_id: z.number().int(),
    error_type: DependencyFindingErrorType,
    error_detail: z.string().nullable().optional(),
    source_entity_type: DependencyErrorSourceType.nullable().optional(),
    source_entity_id: z.number().int().nullable().optional(),
  })
  .loose();
export type DependencyFindingError = z.infer<typeof DependencyFindingError>;

export const BreakingSource = DependencyNode.extend({
  dependents_errors: z.array(DependencyFindingError).nullable().optional(),
});
export type BreakingSource = z.infer<typeof BreakingSource>;

export const BreakingSourceCompact = DependencyNodeCompact.extend({
  dependents_errors: BreakingSource.shape.dependents_errors,
});
export type BreakingSourceCompact = z.infer<typeof BreakingSourceCompact>;

export const DependencyEdge = z
  .object({
    from_entity_type: DependencyType,
    from_entity_id: z.number().int(),
    to_entity_type: DependencyType,
    to_entity_id: z.number().int(),
  })
  .loose();
export type DependencyEdge = z.infer<typeof DependencyEdge>;

export const DependencyGraph = z
  .object({
    nodes: z.array(DependencyNode),
    edges: z.array(DependencyEdge),
  })
  .loose();
export type DependencyGraph = z.infer<typeof DependencyGraph>;

export const DependencyGraphCompact = DependencyGraph.pick({ edges: true })
  .strip()
  .extend({ nodes: z.array(DependencyNodeCompact) });
export type DependencyGraphCompact = z.infer<typeof DependencyGraphCompact>;
