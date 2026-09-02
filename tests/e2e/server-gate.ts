import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import {
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "@metabase/client/version/capabilities";
import type { ServerInfo } from "@metabase/client/version/probe";

import { readBootstrapSync } from "./bootstrap-data";
import { resolveStackId } from "./defaults";

// A dev/head build ("vUNKNOWN", "vLOCAL_DEV", or any "-SNAPSHOT" tag) probes to
// version: null. Treat that as the latest version so every version-gated suite runs — head and
// local dev builds carry the newest features, and skipping them would hide regressions there.
// The premium token-feature is still checked against the live probe, so this only relaxes the
// version that genuinely can't be parsed; a suite whose token-feature the server lacks still skips.
const HEAD_ASSUMED_MAJOR = 9999;

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

function resolveServerInfo(): ServerInfo {
  const { server } = readBootstrapSync();
  if (server.version !== null) {
    return server;
  }
  return {
    version: { tag: "vHEAD", major: HEAD_ASSUMED_MAJOR, patch: 0 },
    tokenFeatures: server.tokenFeatures,
  };
}

// `lane` names the describe or test the caller guards with the returned reason. It is what the
// closing report prints, so an unmet gate says which coverage went dark rather than adding one
// more anonymous digit to vitest's skip count.
export function requireServer(lane: string, required: Partial<Capabilities>): string | null {
  const failure = checkCapabilities(resolveServerInfo(), mergeCapabilities(required));
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

// True only when the server version is known AND below `minVersion` — the exact condition under
// which a non-baseline command's preflight raises a CapabilityError (exit 2) rather than warning
// and proceeding on an unknown version. Lets a suite assert the gate fires on the sub-version
// stacks the matrix boots, inverse to the `requireServer` skip the happy-path suite uses. It logs
// nothing: the branch it selects against is the complementary one, not coverage that went missing.
export function serverVersionBelow(minVersion: number): boolean {
  const { version } = resolveServerInfo();
  return version !== null && version.major < minVersion;
}

// Metabase answers a structurally invalid MBQL 5 definition with a 500 through v61 and a 400 from
// v62 on. A suite asserting "the server, not the client-side validator, rejected this" pins the one
// status its own stack sends, so a 500 where a 400 belongs is still a failure.
const MBQL_REJECTION_STATUS_VERSION = 62;

export function serverRejectedMessage(): string {
  return serverVersionBelow(MBQL_REJECTION_STATUS_VERSION)
    ? "Metabase returned 500."
    : "Metabase returned 400.";
}

// From v62 a query the server cannot normalize — a database id that is not an integer, say — is
// refused with one message for the whole query before any field-level schema check runs; through
// v61 the schema check runs first and names the field it rejected.
const QUERY_NORMALIZATION_VERSION = 62;
const QUERY_NORMALIZATION_MESSAGE = "Invalid query: missing or invalid Database ID (:database)";

export function invalidDatabaseRejection(fieldLevelMessage: string): string {
  return serverVersionBelow(QUERY_NORMALIZATION_VERSION)
    ? fieldLevelMessage
    : QUERY_NORMALIZATION_MESSAGE;
}
