import {
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../../src/core/version/capabilities";
import type { ServerInfo } from "../../src/core/version/probe";

import { readBootstrapSync } from "./bootstrap-data";
import { resolveAssumeHead } from "./defaults";

// Head/nightly builds report version tag "vUNKNOWN" → version: null, which would skip every
// version-gated suite. The matrix runner sets METABASE_CLI_E2E_ASSUME_HEAD on the head lanes
// so those suites run against head (the only place head-only features like workspaces exist).
// The premium token-feature is still checked against the live probe, so the override only
// relaxes the version that genuinely can't be parsed on head.
const HEAD_ASSUMED_MAJOR = 9999;

function resolveServerInfo(): ServerInfo {
  const { server } = readBootstrapSync();
  if (server.version !== null) {
    return server;
  }
  if (!resolveAssumeHead()) {
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
