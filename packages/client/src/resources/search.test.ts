import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  probeResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SEARCH_RESULT = {
  id: 7,
  name: "Orders",
  model: "card",
  description: null,
  archived: false,
  collection: { id: 3, name: "Reports", authority_level: null, type: null },
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const PROBE_URL = `https://mb.example.com/metabase${PROBE_PATH}`;

const VERIFYING_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { content_verification: true },
});

const UNVERIFYING_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { content_verification: false },
});

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("search resource wire requests", () => {
  it("sends every search parameter, repeating the models and created_by keys per value", async () => {
    const { mb, capture } = clientOver([
      probeResponse(VERIFYING_SERVER),
      jsonResponse({ data: [SEARCH_RESULT], total: 1 }),
    ]);

    await mb.search.query({
      q: "orders",
      models: ["card", "dashboard"],
      archived: true,
      limit: 20,
      offset: 40,
      table_db_id: 2,
      verified: true,
      collection: 7,
      created_by: [3, 4],
      search_native_query: true,
      include_metadata: true,
      include_dashboard_questions: true,
    });

    expect(capture.calls).toEqual([
      { url: PROBE_URL, method: "GET", headers: JSON_READ_HEADERS, body: null },
      {
        url: "https://mb.example.com/metabase/api/search?q=orders&models=card&models=dashboard&archived=true&limit=20&offset=40&table_db_id=2&verified=true&collection=7&created_by=3&created_by=4&search_native_query=true&include_metadata=true&include_dashboard_questions=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses the verified filter before the wire on a server without content verification, which drops it", async () => {
    const { mb, capture } = clientOver([probeResponse(UNVERIFYING_SERVER)]);

    const error = await thrownBy(() => mb.search.query({ q: "orders", verified: true }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'content_verification' premium feature (not enabled on this server).",
      feature: "contentVerification",
      since: 58,
      tokenFeature: "content_verification",
      serverVersion: "v1.63.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([PROBE_URL]);
  });

  it("sends an unverified search without asking the server what it grants", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [], total: 0 })]);

    await mb.search.query({ q: "orders", verified: false });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/search?q=orders&verified=false",
    ]);
  });

  it("omits every unset search parameter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [], total: 0 })]);

    await mb.search.query({ q: "orders" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/search?q=orders",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("returns the server's slice alongside its count across the whole result set", async () => {
    const { mb } = clientOver([jsonResponse({ data: [SEARCH_RESULT], total: 137 })]);

    const page = await mb.search.query({ q: "orders", limit: 1 });

    expect(page).toEqual({ data: [SEARCH_RESULT], total: 137 });
  });
});
