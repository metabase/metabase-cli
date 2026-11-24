import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const GROUPS = [
  { id: 2, name: "Administrators", magic_group_type: "admin", member_count: 1 },
  { id: 1, name: "All Users", magic_group_type: "all-internal-users", member_count: 4 },
];

const ANALYSTS = { id: 3, name: "Analysts", magic_group_type: null };

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function clientOver(responses: FetchScript) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("group resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse(GROUPS)]);

    await mb.group.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/group",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers every group with no server total", async () => {
    const { mb } = clientOver([jsonResponse(GROUPS)]);

    expect(await mb.group.list()).toEqual({ data: GROUPS, total: null });
  });

  it("sends the create request with the name", async () => {
    const { mb, capture } = clientOver([jsonResponse(ANALYSTS)]);

    expect(await mb.group.create({ name: "Analysts" })).toEqual(ANALYSTS);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/group",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ name: "Analysts" }),
      },
    ]);
  });

  it("sends the id on the path of the update request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...ANALYSTS, name: "Data analysts" })]);

    await mb.group.update(3, { name: "Data analysts" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/group/3",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ name: "Data analysts" }),
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.group.delete(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/group/3",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});
