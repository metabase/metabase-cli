import { z } from "zod";

import type { Features } from "../version/features";

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

// Kept apart from `SessionProperties` because the shared probe parses with that one, and a setting
// only some callers read must not be able to fail every probe.
export const SessionSettings = SessionProperties.extend({
  "has-user-setup": z.boolean(),
  // Cleared once setup completes.
  "setup-token": z.string().nullable(),
  // Readable by a settings manager only.
  "site-name": z.string().optional(),
  // `null` on a server without `aiFeatureSwitches`, which has neither switch to report.
  "mcp-enabled?": z.boolean().nullable(),
  "ai-features-enabled?": z.boolean().nullable(),
  // Absent on OSS and for an anonymous caller; `null` when the license lacks remote sync.
  "remote-sync-enabled": z.boolean().nullable().optional(),
});
export type SessionSettings = z.infer<typeof SessionSettings>;

const SessionSettingsWireV59 = SessionSettings.omit({
  "mcp-enabled?": true,
  "ai-features-enabled?": true,
});

function fromWireV59(wire: z.infer<typeof SessionSettingsWireV59>): SessionSettings {
  return { ...wire, "mcp-enabled?": null, "ai-features-enabled?": null };
}

/** The shape `GET /api/session/properties` answers on a server with `features`, read as `SessionSettings`. */
export function sessionSettingsSchema(features: Features): z.ZodType<SessionSettings> {
  return features.aiFeatureSwitches
    ? SessionSettings
    : SessionSettingsWireV59.transform(fromWireV59);
}
