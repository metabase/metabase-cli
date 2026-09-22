import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const TAG = {
  id: 5,
  name: "nightly",
  entity_id: null,
  built_in_type: null,
};

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

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire.
const SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: FetchScript) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server: SERVER,
  });
  return { mb, capture };
}

describe("transform-tag resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse([TAG])]);

    await mb.transformTag.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-tag",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TAG])]);

    expect(await mb.transformTag.list()).toEqual({ data: [TAG], total: null });
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(TAG)]);

    await mb.transformTag.create({ name: TAG.name });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-tag",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"nightly"}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying the new name", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TAG, name: "renamed" })]);

    await mb.transformTag.update(5, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-tag/5",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformTag.delete(5);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-tag/5",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});
