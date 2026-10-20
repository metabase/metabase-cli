import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import * as barrel from "@metabase/client";
import { createTransport } from "@metabase/client/http/transport";
import {
  type BodyRoute,
  type MissingField,
  OpenApiBodies,
  type OpenApiDrift,
  openApiDrift,
} from "@metabase/client/version/openapi-drift";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import { USER_AGENT } from "../../packages/cli/src/core/user-agent";
import { readBootstrap } from "./bootstrap-data";
import { type InputPairing, scanInputPairings } from "./body-routes";
import { requireServer, serverHas } from "./server-gate";

const OPENAPI_SPEC_PATH = "/api/docs/openapi.json";
const SPEC_TIMEOUT_MS = 60_000;
const INPUT_SUFFIX = "Input";
const LANE = "openapi-drift";
const NONE = "(none)";

interface RetiredField extends MissingField {
  readonly source: string;
}

// Fields older servers require and newer ones no longer declare, stripping them from the body
// unread. The client sends each to every server, so a newer server's document lacks it by design.
const RETIRED_FIELDS: readonly RetiredField[] = [
  {
    key: "measure.create",
    field: "table_id",
    source:
      "required by metabase release-x.63.x src/metabase/measures/api.clj:41; from release-x.64.x src/metabase/measures/api.clj:63 the table is read off the definition and the closed body drops it",
  },
  {
    key: "segment.create",
    field: "table_id",
    source:
      "required by metabase release-x.63.x src/metabase/segments/api.clj:27; from release-x.64.x src/metabase/segments/api.clj:54 the table is read off the definition and the closed body drops it",
  },
];

interface GatedRoutes {
  readonly served: readonly BodyRoute[];
  readonly skipped: readonly MethodKey[];
}

const PAIRINGS = scanInputPairings();
const ROUTES = gateRoutes(PAIRINGS);

function inputSchema(name: string): BodyRoute["input"] {
  const value: unknown = Reflect.get(barrel, name);
  if (!(value instanceof z.ZodObject)) {
    throw new Error(`${name} is not a Zod object on the client barrel`);
  }
  return value;
}

// A route the server does not serve, an EE route on an OSS stack say, is reported as a skipped lane
// rather than judged against a document that cannot hold it.
function gateRoutes(pairings: readonly InputPairing[]): GatedRoutes {
  const served: BodyRoute[] = [];
  const skipped: MethodKey[] = [];
  for (const { key, input, request } of pairings) {
    if (request === null) {
      continue;
    }
    if (requireServer(`${LANE} › ${key}`, methodRequirements(key)) !== null) {
      skipped.push(key);
      continue;
    }
    served.push({ key, method: request.method, path: request.path, input: inputSchema(input) });
  }
  return { served, skipped };
}

function isRetired({ key, field }: MissingField): boolean {
  return RETIRED_FIELDS.some((retired) => retired.key === key && retired.field === field);
}

function listed(lines: readonly string[]): string {
  return lines.length === 0 ? `  ${NONE}` : lines.map((line) => `  ${line}`).join("\n");
}

function driftReport(
  drift: OpenApiDrift,
  unexplained: readonly MissingField[],
  readMs: number,
): string {
  const unrouted = PAIRINGS.filter((pairing) => pairing.request === null).map(({ key }) => key);
  const retired = RETIRED_FIELDS.filter((entry) =>
    drift.missing.some(({ key, field }) => key === entry.key && field === entry.field),
  );
  return [
    "",
    `${LANE}: read ${OPENAPI_SPEC_PATH} in ${readMs} ms`,
    `${LANE}: ${PAIRINGS.length} paired inputs, ${drift.checked} checked, ${drift.unchecked.length} unchecked, ${ROUTES.skipped.length} skipped, ${unrouted.length} unrouted (${unrouted.join(", ")})`,
    `drift: ${drift.missingRoutes.length + unexplained.length}`,
    "missing routes:",
    listed(drift.missingRoutes),
    "missing fields:",
    listed(unexplained.map(({ key, field }) => `${key} ${field}`)),
    "retired fields (older servers require them, this one drops them):",
    listed(retired.map(({ key, field, source }) => `${key} ${field}: ${source}`)),
    "excused fields (gated on a feature this server lacks):",
    listed(drift.excused.map(({ key, field, feature }) => `${key} ${field} (${feature})`)),
    "unchecked routes:",
    listed(drift.unchecked.map(({ key, reason }) => `${key} (${reason})`)),
    "skipped routes:",
    listed(ROUTES.skipped),
    "extras (declared by the server, absent from the input):",
    listed(drift.extras.map(({ key, fields }) => `${key}: ${fields.join(", ")}`)),
    "",
  ].join("\n");
}

describe("openapi drift e2e", () => {
  it("pairs every input schema on the client barrel with a method, but the two nested in others", () => {
    const paired = new Set(PAIRINGS.map(({ input }) => input));
    const unpaired = Object.keys(barrel)
      .filter((name) => name.endsWith(INPUT_SUFFIX) && !paired.has(name))
      .toSorted();

    expect(unpaired).toEqual(["TipTapNodeInput", "TransformTestInput"]);
  });

  it("routes every paired input to its request, but the dashcard patch the dashboard update writes", () => {
    const unrouted = PAIRINGS.filter(({ request }) => request === null).map(({ key }) => key);

    expect(unrouted).toEqual(["dashboard.updateDashcard"]);
  });

  describe("against the server's OpenAPI document", () => {
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

    it("declares every route and every input field the server serves, but gated and retired ones", () => {
      const drift = openApiDrift(spec, ROUTES.served, serverHas);
      const unexplained = drift.missing.filter((missing) => !isRetired(missing));
      process.stdout.write(driftReport(drift, unexplained, readMs));

      expect({ missingRoutes: drift.missingRoutes, missing: unexplained }).toEqual({
        missingRoutes: [],
        missing: [],
      });
    });
  });
});
