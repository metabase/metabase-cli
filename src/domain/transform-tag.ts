import { z } from "zod";

import type { ResourceView } from "./view";

export const TransformTag = z
  .object({
    id: z.number().int(),
    name: z.string(),
    entity_id: z.string().nullable(),
    built_in_type: z.string().nullable(),
  })
  .loose();
export type TransformTag = z.infer<typeof TransformTag>;

export const TransformTagCompact = TransformTag.pick({
  id: true,
  name: true,
  built_in_type: true,
}).strip();
export type TransformTagCompact = z.infer<typeof TransformTagCompact>;

export const transformTagView: ResourceView<TransformTag> = {
  compactPick: TransformTagCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "built_in_type", label: "Built-in" },
  ],
};

export const TransformTagCreateInput = z
  .object({
    name: z.string().min(1),
  })
  .loose();
export type TransformTagCreateInput = z.infer<typeof TransformTagCreateInput>;

export const TransformTagUpdateInput = TransformTagCreateInput;
export type TransformTagUpdateInput = TransformTagCreateInput;
