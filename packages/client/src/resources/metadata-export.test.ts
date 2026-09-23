import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, TEST_USER_AGENT } from "../testing/fetch-capture";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const EXPORT_TEXT = '{"databases":[],"tables":[],"fields":[]}';

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

// The least server that answers this resource.
const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { serialization: true },
});

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server: SERVER,
  });
  return { mb, capture };
}

describe("metadata-export resource wire requests", () => {
  it("posts the three section switches and hands back the unparsed byte stream", async () => {
    const { mb, capture } = clientOver([
      new Response(EXPORT_TEXT, {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    ]);

    const stream = await mb.metadataExport.download({
      "with-databases": true,
      "with-tables": true,
      "with-fields": false,
    });

    expect(await new Response(stream).text()).toBe(EXPORT_TEXT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/serialization/metadata/export?with-databases=true&with-tables=true&with-fields=false",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});
