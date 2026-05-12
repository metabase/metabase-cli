import { z } from "zod";

import type { ResourceView } from "./view";

const DashboardWidth = z.enum(["fixed", "full"]);

export const Dashcard = z
  .object({
    id: z.number().int(),
    dashboard_id: z.number().int(),
    card_id: z.number().int().nullable(),
    dashboard_tab_id: z.number().int().nullable(),
    row: z.number().int(),
    col: z.number().int(),
    size_x: z.number().int(),
    size_y: z.number().int(),
    entity_id: z.string().nullable(),
    visualization_settings: z.unknown(),
    parameter_mappings: z.array(z.unknown()).nullable(),
    inline_parameters: z.array(z.string()).nullable(),
  })
  .loose();
export type Dashcard = z.infer<typeof Dashcard>;

export const DashcardCompact = Dashcard.pick({
  id: true,
  dashboard_id: true,
  card_id: true,
  dashboard_tab_id: true,
  row: true,
  col: true,
  size_x: true,
  size_y: true,
}).strip();
export type DashcardCompact = z.infer<typeof DashcardCompact>;

export const dashcardView: ResourceView<Dashcard> = {
  compactPick: DashcardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "card_id", label: "Card" },
    { key: "dashboard_tab_id", label: "Tab" },
    { key: "row", label: "Row" },
    { key: "col", label: "Col" },
    { key: "size_x", label: "W" },
    { key: "size_y", label: "H" },
  ],
};

export const DashboardTab = z
  .object({
    id: z.number().int(),
    dashboard_id: z.number().int(),
    name: z.string(),
    position: z.number().int().optional(),
    entity_id: z.string().nullable().optional(),
  })
  .loose();
export type DashboardTab = z.infer<typeof DashboardTab>;

export const DashboardTabCompact = DashboardTab.pick({
  id: true,
  dashboard_id: true,
  name: true,
  position: true,
}).strip();
export type DashboardTabCompact = z.infer<typeof DashboardTabCompact>;

export const Dashboard = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    archived: z.boolean(),
    collection_id: z.number().int().nullable(),
    creator_id: z.number().int(),
    entity_id: z.string().nullable(),
    width: DashboardWidth,
    auto_apply_filters: z.boolean(),
    enable_embedding: z.boolean(),
    public_uuid: z.string().nullable(),
    cache_ttl: z.number().int().nullable(),
    parameters: z.array(z.unknown()).nullable(),
    dashcards: z.array(Dashcard).optional(),
    tabs: z.array(DashboardTab).optional(),
  })
  .loose();
export type Dashboard = z.infer<typeof Dashboard>;

export const DashboardDetail = Dashboard.extend({
  dashcards: z.array(Dashcard),
  tabs: z.array(DashboardTab),
});
export type DashboardDetail = z.infer<typeof DashboardDetail>;

export const DashboardCompact = Dashboard.pick({
  id: true,
  name: true,
  description: true,
  archived: true,
  collection_id: true,
})
  .strip()
  .extend({
    dashcards: z.array(DashcardCompact).optional(),
    tabs: z.array(DashboardTabCompact).optional(),
  });
export type DashboardCompact = z.infer<typeof DashboardCompact>;

export const dashboardView: ResourceView<Dashboard> = {
  compactPick: DashboardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};

export const DashboardCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    parameters: z.array(z.unknown()).optional(),
    cache_ttl: z.number().int().positive().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    dashcards: z.array(z.unknown()).optional(),
    tabs: z.array(DashboardTab.partial()).optional(),
  })
  .loose();
export type DashboardCreateInput = z.infer<typeof DashboardCreateInput>;

export const DashboardUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    width: DashboardWidth.optional(),
    enable_embedding: z.boolean().optional(),
    embedding_params: z.unknown().optional(),
    parameters: z.array(z.unknown()).optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    dashcards: z.array(z.unknown()).optional(),
    tabs: z.array(DashboardTab.partial()).optional(),
  })
  .loose();
export type DashboardUpdateInput = z.infer<typeof DashboardUpdateInput>;

export const DashcardPatchInput = z
  .object({
    row: z.number().int().nonnegative().optional(),
    col: z.number().int().nonnegative().optional(),
    size_x: z.number().int().positive().optional(),
    size_y: z.number().int().positive().optional(),
    dashboard_tab_id: z.number().int().nullable().optional(),
    parameter_mappings: z.array(z.unknown()).optional(),
    inline_parameters: z.array(z.string()).optional(),
    visualization_settings: z.unknown().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "patch must contain at least one field",
  });
export type DashcardPatchInput = z.infer<typeof DashcardPatchInput>;
