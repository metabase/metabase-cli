import { z } from "zod";

import type { ResourceView } from "./view";

export const ServerVersion = z
  .object({
    tag: z.string(),
    date: z.string().optional(),
    hash: z.string().optional(),
  })
  .loose();
export type ServerVersion = z.infer<typeof ServerVersion>;

export const TokenFeatures = z.record(z.string(), z.boolean());
export type TokenFeatures = z.infer<typeof TokenFeatures>;

export const SessionProperties = z
  .object({
    version: ServerVersion,
    "token-features": TokenFeatures.optional(),
  })
  .loose();
export type SessionProperties = z.infer<typeof SessionProperties>;

export const SessionPropertiesCompact = SessionProperties.pick({
  version: true,
  "token-features": true,
}).strip();
export type SessionPropertiesCompact = z.infer<typeof SessionPropertiesCompact>;

export const sessionPropertiesView: ResourceView<SessionProperties> = {
  compactPick: SessionPropertiesCompact,
  tableColumns: [
    { key: "version", label: "Version" },
    { key: "token-features", label: "Token features" },
  ],
};
