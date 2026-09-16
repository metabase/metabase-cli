import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import type { FeatureName } from "@metabase/client/version/features";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { checkFeatures } from "@metabase/client/version/requirement-check";

import { readBootstrapSync } from "./bootstrap-data";
import { resolveStackId } from "./defaults";

const HERE = dirname(fileURLToPath(import.meta.url));

// Gates run at module top level in the test worker, where `isolate: true` resets the module
// registry per file — a module-level array could not accumulate across suites. The stack id scopes
// the file so `e2e:matrix --parallel` stacks in one checkout do not overwrite each other's log.
export const GATE_SKIP_FILE_PATH = resolve(HERE, `.gate-skips.${resolveStackId()}.json`);

const GateSkip = z.object({
  lane: z.string(),
  reason: z.string(),
});
export type GateSkip = z.infer<typeof GateSkip>;

const GateSkipLog = z.array(GateSkip);

export function readGateSkips(): GateSkip[] {
  let raw: string;
  try {
    raw = readFileSync(GATE_SKIP_FILE_PATH, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  return parseJson(raw, GateSkipLog, { source: GATE_SKIP_FILE_PATH });
}

export function clearGateSkips(): void {
  try {
    unlinkSync(GATE_SKIP_FILE_PATH);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

function recordGateSkip(lane: string, reason: string): void {
  const logged = readGateSkips();
  if (logged.some((entry) => entry.lane === lane)) {
    return;
  }
  writeFileSync(GATE_SKIP_FILE_PATH, `${JSON.stringify([...logged, { lane, reason }], null, 2)}\n`);
}

// The same profile the CLI builds from a cached probe, so a gate and the command it guards agree:
// a head build's unparseable tag lands past the newest known major and every version-gated suite
// runs there, while a token feature the server lacks still skips.
function resolveServerProfile(): ServerProfile {
  return createServerProfile(readBootstrapSync().server);
}

// `lane` names the describe or test the caller guards with the returned reason. It is what the
// closing report prints, so an unmet gate says which coverage went dark rather than adding one
// more anonymous digit to vitest's skip count.
export function requireServer(lane: string, required: readonly FeatureName[]): string | null {
  const failure = checkFeatures(required, resolveServerProfile());
  if (failure === null) {
    return null;
  }
  recordGateSkip(lane, failure.detail);
  return failure.detail;
}

const OAUTH_UNSUPPORTED_REASON =
  "server does not support full-API OAuth login (Metabase v63+) — re-run e2e:bootstrap if the image changed";

// Gate for the OAuth login suite: a version check would be wrong here (head images without the
// OAuth backend would run and fail), so bootstrap probes the discovery endpoint live and the
// suite keys off that. The probe also rejects the agent-API-only OAuth server v60–62 ship
// (no full-access scope advertised). Re-run `bun run e2e:bootstrap` after switching images.
export function requireOAuthServer(lane: string): string | null {
  if (readBootstrapSync().server.oauthSupported) {
    return null;
  }
  recordGateSkip(lane, OAUTH_UNSUPPORTED_REASON);
  return OAUTH_UNSUPPORTED_REASON;
}

// The exact question the CLI's preflight and the client's `require()` ask. It logs nothing: a
// suite reading it asserts one of two exact outcomes rather than skipping coverage.
export function serverHas(feature: FeatureName): boolean {
  return resolveServerProfile().features[feature];
}

// A suite asserting "the server, not the client-side validator, rejected this" pins the one status
// its own stack sends, so a 500 where a 400 belongs is still a failure.
export function serverRejectedMessage(): string {
  return serverHas("invalidMbqlIsBadRequest") ? "Metabase returned 400." : "Metabase returned 500.";
}

// A query the server cannot normalize — a database id that is not an integer, say — is refused with
// one message for the whole query where normalization runs before the field-level schema check, and
// with the field the schema check rejected where it does not.
const QUERY_NORMALIZATION_MESSAGE = "Invalid query: missing or invalid Database ID (:database)";

export function invalidDatabaseRejection(fieldLevelMessage: string): string {
  return serverHas("queryNormalizedBeforeValidation")
    ? QUERY_NORMALIZATION_MESSAGE
    : fieldLevelMessage;
}
