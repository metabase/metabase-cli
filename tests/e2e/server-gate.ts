import {
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../../src/core/version/capabilities";

import { readBootstrapSync } from "./bootstrap-data";

export function requireServer(required: Partial<Capabilities>): string | null {
  const { server } = readBootstrapSync();
  const failure = checkCapabilities(server, mergeCapabilities(required));
  return failure === null ? null : failure.detail;
}
