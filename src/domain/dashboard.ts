import { z } from "zod";

import { EmbeddingParams } from "./embedding";
import { Parameter, ParameterMapping } from "./parameter";
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
    parameter_mappings: z.array(ParameterMapping).nullable(),
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
    parameters: z.array(Parameter).nullable(),
    dashcards: z.array(Dashcard).optional(),
    tabs: z.array(DashboardTab).optional(),
  })
  .loose();
export type Dashboard = z.infer<typeof Dashboard>;

export const DashboardDetail = Dashboard.extend({
  parameters: z.array(Parameter),
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

const DashcardWrite = z
  .object({
    id: z.number().int().describe("existing dashcard id; negative to create a new dashcard"),
    size_x: z.number().int().positive(),
    size_y: z.number().int().positive(),
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    parameter_mappings: z.array(ParameterMapping).nullable().optional(),
    inline_parameters: z.array(z.string().min(1)).nullable().optional(),
    series: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  })
  .loose();

const DashboardTabWrite = z
  .object({
    id: z.number().int().describe("existing tab id; negative to create a new tab"),
    name: z.string().min(1),
  })
  .loose();

// The server's POST /api/dashboard takes no dashcards/tabs; the create command
// accepts them anyway and applies them through a follow-up PUT.
export const DashboardCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    parameters: z.array(Parameter).nullable().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    dashcards: z.array(DashcardWrite).optional(),
    tabs: z.array(DashboardTabWrite).optional(),
  })
  .loose();
export type DashboardCreateInput = z.infer<typeof DashboardCreateInput>;

export const DashboardUpdateInput = z
  .object({
    name: z.string().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    caveats: z.string().nullable().optional(),
    points_of_interest: z.string().nullable().optional(),
    show_in_getting_started: z.boolean().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    position: z.number().int().positive().nullable().optional(),
    width: DashboardWidth.optional(),
    enable_embedding: z.boolean().nullable().optional(),
    embedding_type: z.string().nullable().optional(),
    embedding_params: EmbeddingParams.nullable().optional(),
    parameters: z.array(Parameter).nullable().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    dashcards: z.array(DashcardWrite).nullable().optional(),
    tabs: z.array(DashboardTabWrite).nullable().optional(),
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
    parameter_mappings: z.array(ParameterMapping).nullable().optional(),
    inline_parameters: z.array(z.string().min(1)).nullable().optional(),
    visualization_settings: z.unknown().optional(),
    series: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "patch must contain at least one field",
  });
export type DashcardPatchInput = z.infer<typeof DashcardPatchInput>;
