import { z } from "zod";

export const Capabilities = z.object({
  minVersion: z.number(),
  tokenFeature: z.string().optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const BASELINE_CAPABILITIES: Capabilities = Object.freeze({
  minVersion: 58,
});
