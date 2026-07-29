import { z } from "zod";

export const DependencyEntityType = z.enum([
  "card",
  "table",
  "transform",
  "snippet",
  "dashboard",
  "document",
  "sandbox",
  "segment",
  "measure",
]);
export type DependencyEntityType = z.infer<typeof DependencyEntityType>;

export const DependencyCardType = z.enum(["question", "model", "metric"]);
export type DependencyCardType = z.infer<typeof DependencyCardType>;

export const DependencyNode = z.object({
  id: z.number().int().positive(),
  type: DependencyEntityType,
  data: z.record(z.string(), z.unknown()),
  dependents_count: z.record(z.string(), z.number().int().nonnegative()).nullable().optional(),
});
export type DependencyNode = z.infer<typeof DependencyNode>;

export const DependencyBackfillStatus = z.object({ complete: z.boolean() });
export type DependencyBackfillStatus = z.infer<typeof DependencyBackfillStatus>;
