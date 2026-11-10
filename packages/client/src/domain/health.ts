import { z } from "zod";

export const Health = z
  .object({
    // Not an enum: a failure is a sentence naming why the app database is out of reach.
    status: z.string(),
    // Present only while the server is initializing.
    progress: z.number().min(0).max(1).optional(),
  })
  .loose();
export type Health = z.infer<typeof Health>;

export const HealthCompact = Health.pick({
  status: true,
  progress: true,
}).strip();
export type HealthCompact = z.infer<typeof HealthCompact>;
