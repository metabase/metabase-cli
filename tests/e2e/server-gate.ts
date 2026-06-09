import {
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../../src/core/version/capabilities";
import type { ServerInfo } from "../../src/core/version/probe";

import { readBootstrapSync } from "./bootstrap-data";

// An unparsable version tag ("vUNKNOWN", "vLOCAL", any non-semver dev/head build) probes to
// version: null. Treat that as the latest version so every version-gated suite runs — head and
// local dev builds carry the newest features, and skipping them would hide regressions there.
// The premium token-feature is still checked against the live probe, so this only relaxes the
// version that genuinely can't be parsed; a suite whose token-feature the server lacks still skips.
const HEAD_ASSUMED_MAJOR = 9999;

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

export function requireServer(required: Partial<Capabilities>): string | null {
  const failure = checkCapabilities(resolveServerInfo(), mergeCapabilities(required));
  return failure === null ? null : failure.detail;
}

// Gate for the OAuth login suite: a version check would be wrong here (head images without the
// OAuth backend would run and fail), so bootstrap probes the discovery endpoint live and the
// suite keys off that. Re-run `bun run e2e:bootstrap` after switching images.
export function requireOAuthServer(): string | null {
  if (readBootstrapSync().server.oauthSupported) {
    return null;
  }
  return "server does not expose an OAuth authorization server (Metabase v62+) — re-run e2e:bootstrap if the image changed";
}

// True only when the server version is known AND below `minVersion` — the exact condition under
// which a non-baseline command's preflight raises a CapabilityError (exit 2) rather than warning
// and proceeding on an unknown version. Lets a suite assert the gate fires on the sub-version
// stacks the matrix boots, inverse to the `requireServer` skip the happy-path suite uses.
export function serverVersionBelow(minVersion: number): boolean {
  const { version } = resolveServerInfo();
  return version !== null && version.major < minVersion;
}
