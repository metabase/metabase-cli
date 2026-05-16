import type { TokenFeatures } from "../../domain/session-properties";
import type { Edition } from "../../runtime/capabilities";

import type { Build } from "./tag";

export type { Edition };

// Metabase's backend exposes token-features as a flat boolean map with no canonical
// Pro vs Enterprise marker. This set captures the features marketed as Enterprise-only;
// any one of them set true classifies the instance as Enterprise. Pro is the residual.
const ENTERPRISE_TIER_FEATURES: ReadonlySet<string> = new Set([
  "advanced_permissions",
  "attached_dwh",
  "audit_app",
  "config_text_file",
  "database_routing",
  "disable_password_login",
  "scim",
  "session_timeout_config",
  "sso_jwt",
  "sso_ldap",
  "sso_saml",
  "whitelabel",
]);

export function deriveEdition(build: Build, features: TokenFeatures | undefined): Edition {
  if (build === "oss") {
    return "oss";
  }
  if (features === undefined) {
    return "oss";
  }
  let hasAnyPaid = false;
  for (const [key, enabled] of Object.entries(features)) {
    if (!enabled) {
      continue;
    }
    if (ENTERPRISE_TIER_FEATURES.has(key)) {
      return "enterprise";
    }
    hasAnyPaid = true;
  }
  return hasAnyPaid ? "pro" : "oss";
}
