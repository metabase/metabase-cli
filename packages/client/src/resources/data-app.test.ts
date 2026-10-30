import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { DataAppGenerateQueriesInput } from "../domain/data-app";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  premiumRefusalResponse,
  probeResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const APP = {
  id: 4,
  name: "sales-overview",
  display_name: "Sales overview",
  description: null,
  version: 1,
  outdated: false,
  bundle_path: "dist/index.js",
  enabled: false,
  allowed_hosts: [],
  resource_collection_id: 12,
  bundle_hash: null,
  created_at: "2026-01-02T03:04:05.678Z",
  updated_at: "2026-01-02T03:04:05.678Z",
};

const SUMMARY = { name: "sales-overview", display_name: "Sales overview" };

const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "data-apps": true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "data-apps": false },
});

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function clientOver(responses: FetchScript, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("data app resource wire requests", () => {
  it("sends the list request without a query string and reads admin and summary entries", async () => {
    const { mb, capture } = clientOver([jsonResponse([APP, SUMMARY])]);

    const result = await mb.dataApp.list();

    expect(result).toEqual({ data: [APP, SUMMARY], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/apps",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses an admin answer that is neither a data app nor a summary", async () => {
    const { mb } = clientOver([jsonResponse({ ...APP, resource_collection_id: null })]);

    const error = await thrownBy(() => mb.dataApp.get("sales-overview"));

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v1.65.0 (newer than this client supports, up to v64) the response shape was unexpected:\n  Invalid input",
    );
  });

  it("sends the get request with the slug encoded", async () => {
    const { mb, capture } = clientOver([jsonResponse(SUMMARY)]);

    const result = await mb.dataApp.get("sales/overview");

    expect(result).toEqual(SUMMARY);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/apps/sales%2Foverview",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request with only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...APP, enabled: true })]);

    await mb.dataApp.update("sales-overview", { enabled: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/apps/sales-overview",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ enabled: true }),
      },
    ]);
  });

  it("sends the definitions to generate the questions' files", async () => {
    const files = [{ path: "orders_by_month.yaml", contents: "name: ordersByMonth\n" }];
    const { mb, capture } = clientOver([jsonResponse(files)]);
    const body = {
      collection: "AAAAAAAAAAAAAAAAAAAAA",
      queries: {
        ordersByMonth: {
          entityId: "BBBBBBBBBBBBBBBBBBBBB",
          query: { stages: [{ source: { type: "table", id: 1 } }] },
        },
      },
    } satisfies DataAppGenerateQueriesInput;

    const result = await mb.dataApp.generateQueries(body);

    expect(result).toEqual(files);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/apps/generate/queries",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(body),
      },
    ]);
  });

  it("explains a premium refusal as the missing data-apps token", async () => {
    const { mb, capture } = clientOver(
      [premiumRefusalResponse("Data apps"), probeResponse(UNLICENSED_SERVER)],
      UNLICENSED_SERVER,
    );

    const error = await thrownBy(() => mb.dataApp.list());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'data-apps' premium feature (not enabled on this server).",
      feature: "dataApps",
      since: 65,
      tokenFeature: "data-apps",
      serverVersion: "v1.65.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/apps",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });
});
