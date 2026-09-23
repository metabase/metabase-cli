import { describe, expect, it } from "vitest";

import { Collection } from "@metabase/client/domain/collection";

import { syncScopeHint } from "./sync-scope";

const REMOTE_URL = "https://github.com/acme/metabase-sync.git";

function collection(overrides: Partial<Collection>): Collection {
  return Collection.parse({ id: 51, name: "Data", ...overrides });
}

describe("syncScopeHint", () => {
  it("names the unsynced collection and the admin step when a remote is configured", () => {
    const hint = syncScopeHint(collection({ is_remote_synced: false }), REMOTE_URL);
    expect(hint).toBe(
      'Note: collection 51 "Data" is not marked for remote sync, ' +
        `so exports will not carry it (or its published tables' metadata) to ${REMOTE_URL}. ` +
        "An admin adds it to the synced collections in Metabase's remote sync settings.",
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
