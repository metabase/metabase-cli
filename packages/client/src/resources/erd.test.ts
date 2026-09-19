import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const ERD = {
  nodes: [
    {
      table_id: 11,
      name: "orders",
      display_name: "Orders",
      description: null,
      owner: null,
      schema: "public",
      visibility_type: null,
      db_id: 1,
      fields: [
        {
          id: 101,
          name: "customer_id",
          display_name: "Customer ID",
          database_type: "int4",
          base_type: "type/Integer",
          effective_type: "type/Integer",
          semantic_type: "type/FK",
          fk_target_field_id: 201,
          fk_target_table_id: 12,
        },
      ],
    },
  ],
  edges: [
    {
      source_table_id: 11,
      source_field_id: 101,
      target_table_id: 12,
      target_field_id: 201,
      relationship: "many-to-one",
    },
  ],
};

const LICENSED_62 = createServerProfile({
  edition: "ee",
  version: { tag: "v1.62.0", major: 62, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "schema-viewer": true },
});

const UNLICENSED_62 = createServerProfile({
  edition: "ee",
  version: { tag: "v1.62.0", major: 62, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "schema-viewer": false },
});

const LICENSED_61 = createServerProfile({
  edition: "ee",
  version: { tag: "v1.61.0", major: 61, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "schema-viewer": true },
});

function clientOver(responses: Array<Response>, server = LICENSED_62) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("erd resource wire requests", () => {
  it("sends the database id and repeats the key for each focal table", async () => {
    const { mb, capture } = clientOver([jsonResponse(ERD)]);

    await mb.erd.get({ "database-id": 1, "table-ids": [11, 12], schema: "" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/erd?database-id=1&table-ids=11&table-ids=12&schema=",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the diagram as nodes and edges", async () => {
    const { mb } = clientOver([jsonResponse(ERD)]);

    expect(await mb.erd.get({ "database-id": 1 })).toEqual(ERD);
  });

  it("refuses before the wire on a server without the schema viewer token", async () => {
    const { mb, capture } = clientOver([jsonResponse(ERD)], UNLICENSED_62);

    const error = await thrownBy(() => mb.erd.get({ "database-id": 1 }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'schema-viewer' premium feature (not enabled on this server).",
      feature: "erd",
      since: 62,
      tokenFeature: "schema-viewer",
      serverVersion: "v1.62.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses before the wire on a server older than the route, whatever its token grants", async () => {
    const { mb, capture } = clientOver([jsonResponse(ERD)], LICENSED_61);

    const error = await thrownBy(() => mb.erd.get({ "database-id": 1 }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v62+ (this server is v1.61.0). Upgrade Metabase to use it.",
      feature: "erd",
      since: 62,
      tokenFeature: "schema-viewer",
      serverVersion: "v1.61.0",
    });
    expect(capture.calls).toEqual([]);
  });
});
