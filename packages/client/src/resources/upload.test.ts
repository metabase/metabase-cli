import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, TEST_USER_AGENT } from "../testing/fetch-capture";

import type { CsvFile } from "./csv-upload";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CSV_TEXT = "id,name\n1,alice\n";

const CSV_FILE: CsvFile = {
  filename: "people.csv",
  bytes: new TextEncoder().encode(CSV_TEXT),
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
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

function createdResponse(modelId: string, tableId: string | null): Response {
  const headers = tableId === null ? {} : { "metabase-table-id": tableId };
  return new Response(modelId, { headers });
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("upload resource wire requests", () => {
  it("posts the csv as multipart form data alongside the collection id", async () => {
    const { mb, capture } = clientOver([createdResponse("123", "45")]);

    await mb.upload.createFromCsv(CSV_FILE, { collection_id: "root" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/upload/csv",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: {
          parts: [
            {
              name: "file",
              value: CSV_TEXT,
              filename: "people.csv",
              contentType: "text/csv",
            },
            { name: "collection_id", value: "root", filename: null, contentType: null },
          ],
        },
      },
    ]);
  });

  it("reads the model id from the body and the table id from the header", async () => {
    const { mb } = clientOver([createdResponse("  123\n", "45")]);

    await expect(mb.upload.createFromCsv(CSV_FILE, { collection_id: "5" })).resolves.toEqual({
      model_id: 123,
      table_id: 45,
    });
  });

  it("rejects a response body that is not an integer", async () => {
    const { mb } = clientOver([createdResponse("abc", "45")]);

    const error = await thrownBy(() =>
      mb.upload.createFromCsv(CSV_FILE, { collection_id: "root" }),
    );

    assert(error instanceof ResponseShapeError, "expected a ResponseShapeError");
    expect(error.message).toBe('upload succeeded but the response body was not an integer: "abc"');
    expect(error.developerDetail).toEqual({
      kind: "decoded",
      source: "response body",
      value: "abc",
    });
  });

  it("reports an empty response body as a response-shape failure", async () => {
    const { mb } = clientOver([createdResponse("", "45")]);

    const error = await thrownBy(() =>
      mb.upload.createFromCsv(CSV_FILE, { collection_id: "root" }),
    );

    assert(error instanceof ResponseShapeError, "expected a ResponseShapeError");
    expect(error.message).toBe("upload succeeded but the response body was empty");
    expect(error.category).toBe("response-shape");
  });

  it("rejects a response without the table-id header", async () => {
    const { mb } = clientOver([createdResponse("123", null)]);

    const error = await thrownBy(() =>
      mb.upload.createFromCsv(CSV_FILE, { collection_id: "root" }),
    );

    assert(error instanceof ResponseShapeError, "expected a ResponseShapeError");
    expect(error.message).toBe("upload succeeded but the metabase-table-id header was empty");
    expect(error.developerDetail).toEqual({
      kind: "decoded",
      source: "metabase-table-id header",
      value: null,
    });
  });
});
