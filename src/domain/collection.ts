import { z } from "zod";

import type { ResourceView } from "./view";

export const CollectionId = z.union([z.number().int(), z.string()]);
export type CollectionId = z.infer<typeof CollectionId>;

const CollectionAuthorityLevel = z.enum(["official"]);

const CollectionType = z.enum([
  "instance-analytics",
  "trash",
  "library",
  "library-data",
  "library-metrics",
  "tenant-specific-root-collection",
]);

const CollectionNamespace = z.string().min(1);

export const COLLECTION_ITEM_FILTER_MODELS = [
  "card",
  "dataset",
  "metric",
  "dashboard",
  "snippet",
  "collection",
  "document",
  "table",
  "transform",
  "measure",
  "pulse",
  "timeline",
  "no_models",
] as const;
export const CollectionItemFilterModel = z.enum(COLLECTION_ITEM_FILTER_MODELS);
export type CollectionItemFilterModel = z.infer<typeof CollectionItemFilterModel>;

// `indexed-entity` is a valid response model but not accepted as a filter value.
export const COLLECTION_ITEM_MODELS = [...COLLECTION_ITEM_FILTER_MODELS, "indexed-entity"] as const;
export const CollectionItemModel = z.enum(COLLECTION_ITEM_MODELS);
export type CollectionItemModel = z.infer<typeof CollectionItemModel>;

export const COLLECTION_PINNED_STATES = ["all", "is_pinned", "is_not_pinned"] as const;
export const CollectionPinnedState = z.enum(COLLECTION_PINNED_STATES);
export type CollectionPinnedState = z.infer<typeof CollectionPinnedState>;

export const Collection = z
  .object({
    id: CollectionId,
    name: z.string(),
    description: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    location: z.string().nullable().optional(),
    parent_id: CollectionId.nullable().optional(),
    personal_owner_id: z.number().int().nullable().optional(),
    is_personal: z.boolean().optional(),
    authority_level: CollectionAuthorityLevel.nullable().optional(),
    type: CollectionType.nullable().optional(),
    namespace: CollectionNamespace.nullable().optional(),
    entity_id: z.string().nullable().optional(),
    slug: z.string().optional(),
    can_write: z.boolean().optional(),
  })
  .loose();
export type Collection = z.infer<typeof Collection>;

export const CollectionCompact = Collection.pick({
  id: true,
  name: true,
  description: true,
  archived: true,
  location: true,
  parent_id: true,
  type: true,
  authority_level: true,
  is_personal: true,
}).strip();
export type CollectionCompact = z.infer<typeof CollectionCompact>;

export const collectionView: ResourceView<Collection> = {
  compactPick: CollectionCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "location", label: "Location" },
    { key: "type", label: "Type" },
    { key: "authority_level", label: "Authority" },
    { key: "archived", label: "Archived" },
  ],
};

// `archived` and `display` arrive as null on the wire for some model types (snippet,
// pulse, timeline, transform, document, table) — those queries don't select the column,
// so the union-all pads it with null. Stay permissive.
export const CollectionItem = z
  .object({
    id: z.number().int(),
    model: CollectionItemModel,
    name: z.string(),
    description: z.string().nullable().optional(),
    archived: z.boolean().nullable(),
    collection_id: CollectionId.nullable().optional(),
    collection_position: z.number().int().nullable().optional(),
    display: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    entity_id: z.string().nullable().optional(),
    database_id: z.number().int().nullable().optional(),
    dashboard_id: z.number().int().nullable().optional(),
  })
  .loose();
export type CollectionItem = z.infer<typeof CollectionItem>;

export const CollectionItemCompact = CollectionItem.pick({
  id: true,
  model: true,
  name: true,
  description: true,
  archived: true,
  collection_id: true,
}).strip();
export type CollectionItemCompact = z.infer<typeof CollectionItemCompact>;

export const collectionItemView: ResourceView<CollectionItem> = {
  compactPick: CollectionItemCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "model", label: "Model" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};

const CollectionTreeNodeBase = z
  .object({
    id: CollectionId,
    name: z.string(),
    description: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    location: z.string().nullable().optional(),
    type: CollectionType.nullable().optional(),
    authority_level: CollectionAuthorityLevel.nullable().optional(),
    here: z.array(CollectionItemModel).optional(),
    below: z.array(CollectionItemModel).optional(),
  })
  .loose();

export type CollectionTreeNode = z.infer<typeof CollectionTreeNodeBase> & {
  children: CollectionTreeNode[];
};

export const CollectionTreeNode: z.ZodType<CollectionTreeNode> = CollectionTreeNodeBase.extend({
  children: z.lazy(() => z.array(CollectionTreeNode)),
});

export const CollectionCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    parent_id: z.number().int().positive().nullable().optional(),
    namespace: CollectionNamespace.nullable().optional(),
    authority_level: CollectionAuthorityLevel.nullable().optional(),
  })
  .loose();
export type CollectionCreateInput = z.infer<typeof CollectionCreateInput>;
