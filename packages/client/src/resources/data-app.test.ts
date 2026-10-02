import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { DataAppCreateInput } from "../domain/data-app";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const DATA_APP = {
  id: 3,
  name: "sales-overview",
  display_name: "Sales overview",
  description: null,
  version: 2,
  outdated: false,
  bundle_path: "dist/index.js",
  enabled: true,
  allowed_hosts: [],
  resource_collection_id: 11,
  permission_group_id: 12,
  table_ids: [4, 5],
  bundle_hash: "abc",
  created_at: "2026-10-02T03:04:05.678Z",
  updated_at: "2026-10-02T03:04:05.678Z",
};

const CREATE_BODY: DataAppCreateInput = {
  name: "sales-overview",
  display_name: "Sales overview",
  bundle_path: "dist/index.js",
  bundle: "globalThis.__dataAppFactory__ = () => ({});",
};

function serverAt(major: number, tokenFeatures: Record<string, boolean> | null): ServerProfile {
  return createServerProfile({
    edition: "ee",
    version: { kind: "release", tag: `v1.${major}.0`, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  });
}

const HEAD_SERVER = serverAt(65, { "data-apps": true });

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

function clientOver(responses: Array<Response>, server: ServerProfile = HEAD_SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("data-app resource wire requests", () => {
  it("sends the list request with the available filter, and reads a non-admin's summary rows", async () => {
    const summary = { name: "sales-overview", display_name: "Sales overview" };
    const { mb, capture } = clientOver([jsonResponse([summary])]);

    const result = await mb.dataApp.list({ available: true });

    expect(result).toEqual({ data: [summary], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/apps?available=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("encodes the slug in the get path", async () => {
    const { mb, capture } = clientOver([jsonResponse(DATA_APP)]);

    await mb.dataApp.get("sales-overview");

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/apps/sales-overview",
    ]);
  });

  it("sends the create request with the full body", async () => {
    const { mb, capture } = clientOver([jsonResponse(DATA_APP)]);

    await mb.dataApp.create(CREATE_BODY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/apps",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(CREATE_BODY),
      },
    ]);
  });

  it("sends the update request with only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DATA_APP, enabled: false })]);

    await mb.dataApp.update("sales-overview", { enabled: false });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/apps/sales-overview",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ enabled: false }),
      },
    ]);
  });

  it("sends delete, draft, repo-status and permission-warnings to their routes", async () => {
    const { mb, capture } = clientOver([
      new Response(null, { status: 204 }),
      jsonResponse(DATA_APP),
      jsonResponse({ configured: true, url: "git@example.com:apps.git" }),
      jsonResponse([{ user_id: 4, missing_tables: [] }]),
    ]);

    await mb.dataApp.delete("sales-overview");
    await mb.dataApp.draft("sales-overview");
    await mb.dataApp.repoStatus();
    await mb.dataApp.permissionWarnings("sales-overview", { user_ids: [4] });

    expect(capture.calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: "DELETE",
        url: "https://mb.example.com/metabase/api/apps/sales-overview",
        body: null,
      },
      {
        method: "POST",
        url: "https://mb.example.com/metabase/api/apps/sales-overview/draft",
        body: null,
      },
      { method: "GET", url: "https://mb.example.com/metabase/api/apps/repo-status", body: null },
      {
        method: "POST",
        url: "https://mb.example.com/metabase/api/apps/sales-overview/user-permission-warnings",
        body: JSON.stringify({ user_ids: [4] }),
      },
    ]);
  });

  it("asks for the TypeScript schema with the scope as query parameters and returns the module text", async () => {
    const module = "export default {};\n";
    const { mb, capture } = clientOver([
      new Response(module, { headers: { "content-type": "text/typescript; charset=utf-8" } }),
    ]);

    const result = await mb.dataApp.schema({
      libraryCollections: ["5", "abc"],
      includeModels: true,
    });

    expect(result).toBe(module);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/typed-schemas/v1/typescript?library-collections=5%2Cabc&include-models=true",
        method: "GET",
        headers: { ...JSON_READ_HEADERS, accept: "text/*" },
        body: null,
      },
    ]);
  });

  it("refuses data-app methods before any request on a server without the data-apps feature", async () => {
    const { mb, capture } = clientOver([], serverAt(65, { "data-apps": false }));

    await expect(mb.dataApp.list()).rejects.toBeInstanceOf(CapabilityError);
    expect(capture.calls).toEqual([]);
  });
});
