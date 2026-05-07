import { ConfigError } from "../core/errors";
import { isMbql5Query, validateInternalQuery } from "../core/schema/validate";
import { writeJson } from "../output/render";

// Skips MBQL 4 / native — we only have a schema for MBQL 5 today, and the
// legacy formats are still accepted by the server.
export function preflightInternalMbql5Query(query: unknown, contextLabel: string): void {
  if (!isMbql5Query(query)) {
    return;
  }
  const outcome = validateInternalQuery(query);
  if (outcome.ok) {
    return;
  }
  writeJson(outcome);
  throw new ConfigError(
    `${contextLabel}: ${outcome.errors.length} error(s) — pass valid MBQL 5 or use the legacy format`,
  );
}
