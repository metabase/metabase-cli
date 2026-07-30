import { z } from "zod";

const ServerVersion = z
  .object({
    tag: z.string(),
    date: z.string().optional(),
    hash: z.string().optional(),
  })
  .loose();

export const TokenFeatures = z.record(z.string(), z.boolean());
export type TokenFeatures = z.infer<typeof TokenFeatures>;

export const SessionProperties = z
  .object({
    version: ServerVersion,
    "token-features": TokenFeatures.optional(),
  })
  .loose();
export type SessionProperties = z.infer<typeof SessionProperties>;
