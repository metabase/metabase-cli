import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const DOCUMENT = {
  id: 4,
  name: "Runbook",
  document: { type: "doc" },
  entity_id: "bbbbbbbbbbbbbbbbbbbbb",
  collection_id: 3,
  creator_id: 1,
  archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DOCUMENT_BODY = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { _id: "6f1a" } }],
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

// The first server that copies a document, and the last before it.
const SERVER_59 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const SERVER_58 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.58.2", major: 58, patch: 2 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: Array<Response>, server = SERVER_59) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("document resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ items: [DOCUMENT] })]);

    await mb.document.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the { items } list envelope into a ListResult with no server count", async () => {
    const { mb } = clientOver([jsonResponse({ items: [DOCUMENT] })]);

    expect(await mb.document.list()).toEqual({ data: [DOCUMENT], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(DOCUMENT)]);

    await mb.document.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(DOCUMENT)]);

    await mb.document.create({ name: "Runbook", document: DOCUMENT_BODY, collection_id: 3 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Runbook","document":{"type":"doc","content":[{"type":"paragraph","attrs":{"_id":"6f1a"}}]},"collection_id":3}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DOCUMENT, name: "Renamed" })]);

    await mb.document.update(4, { name: "Renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DOCUMENT, archived: true })]);

    await mb.document.archive(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  it("sends the copy request with the destination and name it was given", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ ...DOCUMENT, id: 9, name: "Runbook copy", collection_id: 7 }),
    ]);

    await mb.document.copy(4, { name: "Runbook copy", collection_id: 7 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4/copy",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Runbook copy","collection_id":7}',
      },
    ]);
  });

  it("sends an empty copy body when no override is given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DOCUMENT, id: 9 })]);

    await mb.document.copy(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4/copy",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: "{}",
      },
    ]);
  });

  it("refuses the copy before the wire on a server without the route", async () => {
    const { mb, capture } = clientOver([jsonResponse(DOCUMENT)], SERVER_58);

    const error = await thrownBy(() => mb.document.copy(4));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.2). Upgrade Metabase to use it.",
      feature: "documentCopy",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.2",
    });
    expect(capture.calls).toEqual([]);
  });
});
