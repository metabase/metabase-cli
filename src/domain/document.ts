import { z } from "zod";

import type { ResourceView } from "./view";

export const TipTapNode = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  marks: z.array(z.record(z.string(), z.unknown())).optional(),
  get content() {
    return z.array(TipTapNode).optional();
  },
});
export type TipTapNode = z.infer<typeof TipTapNode>;

export const TipTapNodeInput = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  attrs: z.looseObject({ _id: z.string().min(1) }),
  marks: z.array(z.record(z.string(), z.unknown())).optional(),
  get content() {
    return z.array(TipTapNodeInput).optional();
  },
});
export type TipTapNodeInput = z.infer<typeof TipTapNodeInput>;

const DocumentCreator = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .loose();

export const Document = z
  .object({
    id: z.number().int(),
    name: z.string(),
    document: TipTapNode.nullable(),
    entity_id: z.string().nullable(),
    collection_id: z.number().int().nullable(),
    collection_position: z.number().int().nullable().optional(),
    creator_id: z.number().int(),
    creator: DocumentCreator.nullable().optional(),
    archived: z.boolean(),
    can_write: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    can_restore: z.boolean().optional(),
    is_remote_synced: z.boolean().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type Document = z.infer<typeof Document>;

export const DocumentCompact = Document.pick({
  id: true,
  name: true,
  collection_id: true,
  archived: true,
  creator_id: true,
  can_write: true,
}).strip();
export type DocumentCompact = z.infer<typeof DocumentCompact>;

export const documentView: ResourceView<Document> = {
  compactPick: DocumentCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "creator_id", label: "Creator" },
    { key: "archived", label: "Archived" },
  ],
};

export const DocumentCreateInput = z
  .object({
    name: z.string().min(1),
    document: TipTapNodeInput,
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type DocumentCreateInput = z.infer<typeof DocumentCreateInput>;

export const DocumentUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    document: TipTapNodeInput.optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .loose();
export type DocumentUpdateInput = z.infer<typeof DocumentUpdateInput>;
