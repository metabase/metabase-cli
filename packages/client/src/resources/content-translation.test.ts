import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import type { CsvFile } from "./csv-upload";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CSV_TEXT = "Language,String,Translation\nsv,Title,Rubrik\nar,Cat,قطة\n";

const CSV_FILE: CsvFile = {
  filename: "translations.csv",
  bytes: new TextEncoder().encode(CSV_TEXT),
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("content-translation resource wire requests", () => {
  it("downloads the dictionary as an unparsed byte stream", async () => {
    const { mb, capture } = clientOver([
      new Response(CSV_TEXT, { headers: { "content-type": "text/csv; charset=utf-8" } }),
    ]);

    const stream = await mb.contentTranslation.download();

    expect(await new Response(stream).text()).toBe(CSV_TEXT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/content-translation/csv",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("uploads the complete CSV as multipart form data", async () => {
    const { mb, capture } = clientOver([jsonResponse({ success: true })]);

    await mb.contentTranslation.upload(CSV_FILE);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/content-translation/upload-dictionary",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: {
          parts: [
            {
              name: "file",
              value: CSV_TEXT,
              filename: "translations.csv",
              contentType: "text/csv",
            },
          ],
        },
      },
    ]);
  });
});
