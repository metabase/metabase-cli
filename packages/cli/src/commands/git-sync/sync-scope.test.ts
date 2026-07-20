import { describe, expect, it } from "vitest";

import type { Client } from "../../core/http/client";
import { HttpError } from "../../core/http/errors";
import { Collection } from "../../domain/collection";

import { fetchRemoteSyncUrlIfReadable, fetchSyncedCollections, syncScopeHint } from "./sync-scope";

const REMOTE_URL = "https://github.com/acme/metabase-sync.git";

function collection(overrides: Partial<Collection>): Collection {
  return Collection.parse({ id: 51, name: "Data", ...overrides });
}

function clientRespondingWith(requestRaw: Client["requestRaw"]): Client {
  return {
    requestRaw,
    requestParsed: () => {
      throw new Error("requestParsed is not used by fetchRemoteSyncUrlIfReadable");
    },
    requestStream: () => {
      throw new Error("requestStream is not used by fetchRemoteSyncUrlIfReadable");
    },
  };
}

function clientListing(rows: unknown): Client {
  return {
    requestParsed: async (schema) => schema.parse(rows),
    requestRaw: () => {
      throw new Error("requestRaw is not used by fetchSyncedCollections");
    },
    requestStream: () => {
      throw new Error("requestStream is not used by fetchSyncedCollections");
    },
  };
}

function settingResponse(jsonBody: string): Response {
  return new Response(jsonBody, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function settingError(status: number): HttpError {
  return new HttpError({
    status,
    statusText: "",
    method: "GET",
    url: "https://mb.example.test/api/setting/remote-sync-url",
    responseHeaders: {},
    rawBody: null,
  });
}

describe("syncScopeHint", () => {
  it("returns the add-collection recipe when the collection is unsynced and a remote is configured", () => {
    const hint = syncScopeHint(collection({ is_remote_synced: false }), REMOTE_URL);
    expect(hint).toBe(
      'Note: collection 51 "Data" is not marked for git-sync, ' +
        `so \`mb git-sync export\` will not carry it (or its published tables' metadata) to ${REMOTE_URL}. ` +
        "Add it with: mb git-sync add-collection 51",
    );
  });

  it("returns null when the collection is already synced", () => {
    expect(syncScopeHint(collection({ is_remote_synced: true }), REMOTE_URL)).toBeNull();
  });

  it("returns null when the server does not report the flag", () => {
    expect(syncScopeHint(collection({}), REMOTE_URL)).toBeNull();
  });

  it("returns null when no remote sync url is configured", () => {
    expect(syncScopeHint(collection({ is_remote_synced: false }), null)).toBeNull();
  });

  it("returns null without a collection", () => {
    expect(syncScopeHint(null, REMOTE_URL)).toBeNull();
  });
});

describe("fetchSyncedCollections", () => {
  it("returns id and name of only the collections flagged for sync", async () => {
    const client = clientListing([
      { id: 51, name: "Data", is_remote_synced: false },
      { id: 4, name: "Ops", is_remote_synced: true },
      { id: "root", name: "Our analytics", is_remote_synced: false },
      { id: 9, name: "Legacy", is_remote_synced: null },
    ]);
    await expect(fetchSyncedCollections(client)).resolves.toEqual([{ id: 4, name: "Ops" }]);
  });
});

describe("fetchRemoteSyncUrlIfReadable", () => {
  it("returns the configured url", async () => {
    const client = clientRespondingWith(async () => settingResponse(JSON.stringify(REMOTE_URL)));
    await expect(fetchRemoteSyncUrlIfReadable(client)).resolves.toBe(REMOTE_URL);
  });

  it("normalizes an empty-string setting to null", async () => {
    const client = clientRespondingWith(async () => settingResponse('""'));
    await expect(fetchRemoteSyncUrlIfReadable(client)).resolves.toBeNull();
  });

  it("returns null when the setting is unset", async () => {
    const client = clientRespondingWith(async () => settingResponse("null"));
    await expect(fetchRemoteSyncUrlIfReadable(client)).resolves.toBeNull();
  });

  it("returns null when the caller may not read settings (403)", async () => {
    const client = clientRespondingWith(async () => {
      throw settingError(403);
    });
    await expect(fetchRemoteSyncUrlIfReadable(client)).resolves.toBeNull();
  });

  it("returns null when the setting is not registered on the server (404)", async () => {
    const client = clientRespondingWith(async () => {
      throw settingError(404);
    });
    await expect(fetchRemoteSyncUrlIfReadable(client)).resolves.toBeNull();
  });

  it("rethrows other HTTP errors", async () => {
    const client = clientRespondingWith(async () => {
      throw settingError(500);
    });
    const result = fetchRemoteSyncUrlIfReadable(client);
    await expect(result).rejects.toBeInstanceOf(HttpError);
    await expect(result).rejects.toThrow("Metabase returned 500.");
  });
});
