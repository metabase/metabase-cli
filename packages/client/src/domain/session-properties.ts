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
  // `null` where the server has neither switch to report, as on a server before 60.1.
  "mcp-enabled?": z.boolean().nullable(),
  "ai-features-enabled?": z.boolean().nullable(),
  // Absent on OSS and for an anonymous caller; `null` when the license lacks remote sync.
  "remote-sync-enabled": z.boolean().nullable().optional(),
});
export type SessionSettings = z.infer<typeof SessionSettings>;

// A 60 server reports the AI switches from 60.1 on, so through 60 either may be absent, which reads
// as `null`: the server cannot say.
const SessionSettingsWireV60 = SessionSettings.extend({
  "mcp-enabled?": z.boolean().nullable().optional(),
  "ai-features-enabled?": z.boolean().nullable().optional(),
});

function fromWireV60(wire: z.infer<typeof SessionSettingsWireV60>): SessionSettings {
  return {
    ...wire,
    "mcp-enabled?": wire["mcp-enabled?"] ?? null,
    "ai-features-enabled?": wire["ai-features-enabled?"] ?? null,
  };
}

/** The shape `GET /api/session/properties` answers on a server with `features`, read as `SessionSettings`. */
export function sessionSettingsSchema(features: Features): z.ZodType<SessionSettings> {
  return features.aiFeatureSwitches
    ? SessionSettings
    : SessionSettingsWireV60.transform(fromWireV60);
}
