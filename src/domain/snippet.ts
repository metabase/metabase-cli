import { z } from "zod";

import type { ResourceView } from "./view";

export const Snippet = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    archived: z.boolean(),
    collection_id: z.number().int().nullable(),
    creator_id: z.number().int(),
    entity_id: z.string().nullable(),
    template_tags: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type Snippet = z.infer<typeof Snippet>;

export const SnippetCompact = Snippet.pick({
  id: true,
  name: true,
  description: true,
  archived: true,
  collection_id: true,
}).strip();
export type SnippetCompact = z.infer<typeof SnippetCompact>;

export const snippetView: ResourceView<Snippet> = {
  compactPick: SnippetCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};

export const SnippetCreateInput = z
  .object({
    name: z.string().min(1),
    content: z.string(),
    description: z.string().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type SnippetCreateInput = z.infer<typeof SnippetCreateInput>;

export const SnippetUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    content: z.string().optional(),
    description: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type SnippetUpdateInput = z.infer<typeof SnippetUpdateInput>;
