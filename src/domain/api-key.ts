import { z } from "zod";

import type { ResourceView } from "./view";

export const ApiKeyCreateInput = z
  .object({
    name: z.string().min(1),
    group_id: z.number().int().positive(),
  })
  .loose();
export type ApiKeyCreateInput = z.infer<typeof ApiKeyCreateInput>;

const ApiKeyGroup = z
  .object({
    id: z.number().int().nullable(),
    name: z.string().nullable(),
  })
  .loose();

const ApiKeyUpdatedBy = z
  .object({
    id: z.number().int(),
    common_name: z.string().nullable().optional(),
  })
  .loose();

export const ApiKey = z
  .object({
    id: z.number().int(),
    name: z.string(),
    group: ApiKeyGroup.nullable().optional(),
    unmasked_key: z.string().nullable().optional(),
    masked_key: z.string().nullable().optional(),
    updated_by: ApiKeyUpdatedBy.nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .loose();
export type ApiKey = z.infer<typeof ApiKey>;

export const ApiKeyCompact = ApiKey.pick({
  id: true,
  name: true,
  group: true,
  masked_key: true,
}).strip();
export type ApiKeyCompact = z.infer<typeof ApiKeyCompact>;

export const apiKeyView: ResourceView<ApiKey> = {
  compactPick: ApiKeyCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "group", label: "Group", format: (value) => formatGroup(value) },
    { key: "unmasked_key", label: "Key" },
  ],
};

function formatGroup(value: unknown): string {
  const parsed = ApiKeyGroup.nullable().safeParse(value);
  if (!parsed.success || parsed.data === null) {
    return "";
  }
  const { id, name } = parsed.data;
  if (name === null && id === null) {
    return "";
  }
  if (name === null) {
    return String(id);
  }
  return id === null ? name : `${name} (${id})`;
}
