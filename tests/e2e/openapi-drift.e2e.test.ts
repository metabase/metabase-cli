import { beforeAll, describe, expect, it } from "vitest";

import { createTransport } from "@metabase/client/http/transport";
import {
  type BodyRoute,
  OpenApiBodies,
  type OpenApiDrift,
  openApiDrift,
} from "@metabase/client/testing/openapi-drift";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import { USER_AGENT } from "../../packages/cli/src/core/user-agent";
import { readBootstrap } from "./bootstrap-data";
import { type PairedBody, scanBodyMethods } from "./body-routes";
import { requireServer, serverHas } from "./server-gate";

const OPENAPI_SPEC_PATH = "/api/docs/openapi.json";
const SPEC_TIMEOUT_MS = 60_000;
const LANE = "openapi-drift";
const NONE = "(none)";

interface GatedRoutes {
  readonly served: readonly BodyRoute[];
  readonly skipped: readonly MethodKey[];
}

const ROUTES = gateRoutes(scanBodyMethods().paired);

function gateRoutes(paired: readonly PairedBody[]): GatedRoutes {
  const served: BodyRoute[] = [];
  const skipped: MethodKey[] = [];
  for (const { key, request, input } of paired) {
    if (requireServer(`${LANE} › ${key}`, methodRequirements(key)) !== null) {
      skipped.push(key);
      continue;
    }
    served.push({ key, method: request.method, path: request.path, input });
  }
  return { served, skipped };
}

function listed(lines: readonly string[]): string {
  return lines.length === 0 ? `  ${NONE}` : lines.map((line) => `  ${line}`).join("\n");
}

function driftReport(drift: OpenApiDrift, readMs: number): string {
  return [
    `${LANE}: read ${OPENAPI_SPEC_PATH} in ${readMs} ms`,
    `${LANE}: ${ROUTES.served.length} served, ${drift.checked} checked, ${drift.unchecked.length} unchecked, ${ROUTES.skipped.length} skipped`,
    "missing routes:",
    listed(drift.missingRoutes),
    "missing fields:",
    listed(drift.missing.map(({ key, field }) => `${key} ${field}`)),
    "excused fields (gated on a feature this server lacks, or dropped by one it holds):",
    listed(drift.excused.map(({ key, field, feature }) => `${key} ${field} (${feature})`)),
    "unchecked routes:",
    listed(drift.unchecked.map(({ key, reason }) => `${key} (${reason})`)),
    "skipped routes:",
    listed(ROUTES.skipped),
    "extras (declared by the server, absent from the input):",
    listed(drift.extras.map(({ key, fields }) => `${key}: ${fields.join(", ")}`)),
  ].join("\n");
}

describe("openapi drift e2e", () => {
  let spec: OpenApiBodies;
  let readMs: number;

  beforeAll(async () => {
    const bootstrap = await readBootstrap();
    const transport = createTransport(
      { url: bootstrap.baseUrl, credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey } },
      { userAgent: USER_AGENT },
    );
    const started = performance.now();
    spec = await transport.requestParsed(OpenApiBodies, OPENAPI_SPEC_PATH, {
      timeoutMs: SPEC_TIMEOUT_MS,
    });
    readMs = Math.round(performance.now() - started);
  });

  it("declares every route and every input field the server serves, but gated ones, and names a property in every body", () => {
    const drift = openApiDrift(spec, ROUTES.served, serverHas);
    const { missingRoutes, missing, unchecked } = drift;

    expect({ missingRoutes, missing, unchecked }, driftReport(drift, readMs)).toEqual({
      missingRoutes: [],
      missing: [],
      unchecked: [],
    });
  });
});
