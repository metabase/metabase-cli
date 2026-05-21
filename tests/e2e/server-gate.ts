import {
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../../src/core/version/capabilities";
import type { ServerInfo } from "../../src/core/version/probe";
import { Edition } from "../../src/runtime/capabilities";

import { readBootstrapSync } from "./bootstrap-data";

// Head/nightly builds report version tag "vUNKNOWN" → version: null. The matrix runner
// sets METABASE_CLI_E2E_ASSUME_EDITION on the head lanes so capability-gated suites are
// validated against head (the only place head-only features like workspaces exist) rather
// than skipped. The premium token-feature is still checked against the live probe, so the
// override only relaxes the version/edition that genuinely can't be parsed on head.
const HEAD_ASSUMED_MAJOR = 9999;

function resolveServerInfo(): ServerInfo {
  const { server } = readBootstrapSync();
  if (server.version !== null) {
    return server;
  }
  const assumedEdition = process.env["METABASE_CLI_E2E_ASSUME_EDITION"];
  if (assumedEdition === undefined) {
    return server;
  }
  const edition = Edition.parse(assumedEdition);
  return {
    version: { tag: "vHEAD", build: edition, major: HEAD_ASSUMED_MAJOR, patch: 0 },
    edition,
    tokenFeatures: server.tokenFeatures,
  };
}

export function requireServer(required: Partial<Capabilities>): string | null {
  const failure = checkCapabilities(resolveServerInfo(), mergeCapabilities(required));
  return failure === null ? null : failure.detail;
}
