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

// The TipTap editor anchors these node types with an `_id` (each opts in via `createIdAttribute()`
// in the Metabase frontend) and drops it on others; keep this set in sync with that editor.
export const TIPTAP_NODE_TYPES_WITH_ID = [
  "paragraph",
  "heading",
  "codeBlock",
  "orderedList",
  "bulletList",
  "blockquote",
  "cardEmbed",
  "supportingText",
] as const;

const NODE_TYPES_WITH_ID: ReadonlySet<string> = new Set(TIPTAP_NODE_TYPES_WITH_ID);

function validateNodeId({ type, attrs, content = [] }: TipTapNode): boolean {
  const id = attrs?.["_id"];
  if (NODE_TYPES_WITH_ID.has(type) && (typeof id !== "string" || id === "")) {
    return false;
  }
  return content.every(validateNodeId);
}

export const TipTapNodeInput = TipTapNode.refine(validateNodeId, {
  message: `every ${[...NODE_TYPES_WITH_ID].join(", ")} node needs a non-empty string \`_id\` (mint with \`mb uuid\`)`,
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

const DocumentName = z.string().min(1).max(254);

const DocumentCardInput = z
  .object({
    name: z.string().min(1),
    dataset_query: z.record(z.string(), z.unknown()),
    display: z.string().min(1),
    visualization_settings: z.record(z.string(), z.unknown()),
    entity_id: z.string().min(1).nullable().optional(),
    parameters: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    parameter_mappings: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    description: z.string().min(1).nullable().optional(),
    result_metadata: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
  })
  .loose();

const NEW_CARD_KEY_DESCRIPTION =
  "cards to create inline, keyed by the negative placeholder id referenced from cardEmbed nodes";

export const DocumentCreateInput = z
  .object({
    name: DocumentName,
    document: TipTapNodeInput,
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    cards: z
      .record(z.string().regex(/^-\d+$/), DocumentCardInput)
      .nullable()
      .optional()
      .describe(NEW_CARD_KEY_DESCRIPTION),
  })
  .loose();
export type DocumentCreateInput = z.infer<typeof DocumentCreateInput>;

export const DocumentUpdateInput = z
  .object({
    name: DocumentName.optional(),
    document: TipTapNodeInput.optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    cards: z
      .record(z.string().regex(/^-?\d+$/), DocumentCardInput)
      .nullable()
      .optional()
      .describe("cards keyed by card id; negative ids create new cards"),
  })
  .loose();
export type DocumentUpdateInput = z.infer<typeof DocumentUpdateInput>;
