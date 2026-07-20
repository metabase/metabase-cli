import { z } from "zod";

import type { ResourceView } from "./view";

export const EID_MODELS = [
  "action",
  "card",
  "collection",
  "dashboard",
  "dashboard-card",
  "dashboard-tab",
  "dataset",
  "dimension",
  "document",
  "measure",
  "metric",
  "permissions-group",
  "pulse",
  "pulse-card",
  "pulse-channel",
  "segment",
  "snippet",
  "timeline",
  "transform",
  "user",
] as const;

export const EidModel = z.enum(EID_MODELS);
export type EidModel = z.infer<typeof EidModel>;

export const EidTranslateInput = z
  .object({
    // partialRecord (not record) — Zod 4's z.record(enum, …) treats every
    // enum key as required, but the API accepts any subset of models.
    entity_ids: z.partialRecord(EidModel, z.array(z.string().length(21))),
  })
  .loose();
export type EidTranslateInput = z.infer<typeof EidTranslateInput>;

export const EidTranslateEntry = z
  .object({
    status: z.string(),
    type: EidModel,
    id: z.number().int().optional(),
  })
  .loose();
export type EidTranslateEntry = z.infer<typeof EidTranslateEntry>;

export const EidTranslateResult = z
  .object({
    entity_ids: z.record(z.string(), EidTranslateEntry),
  })
  .loose();
export type EidTranslateResult = z.infer<typeof EidTranslateResult>;

export const EidTranslateResultCompact = EidTranslateResult.pick({
  entity_ids: true,
}).strip();
export type EidTranslateResultCompact = z.infer<typeof EidTranslateResultCompact>;

export const eidTranslateView: ResourceView<EidTranslateResult> = {
  compactPick: EidTranslateResultCompact,
  tableColumns: [{ key: "entity_ids", label: "Translated" }],
};
