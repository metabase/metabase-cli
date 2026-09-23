import { describe, expect, it } from "vitest";

import type { ConnectionState } from "../contracts/connection";

import { connectionWarning } from "./connection-warning";

const USER = { id: 1, email: "ada@example.com", name: "Ada Lovelace", isSuperuser: true };
const SERVER = {
  version: "v1.60.0",
  edition: "ee",
  features: { remoteSync: true, transforms: true, transformTests: true },
} as const;
const URL_TEXT = "https://metabase.example.com/";

describe("connectionWarning", () => {
  it("says nothing while the app is connected", () => {
    const state: ConnectionState = {
      kind: "connected",
      url: URL_TEXT,
      user: USER,
      server: SERVER,
      connectedAt: "2026-09-22T10:00:00.000Z",
    };
    expect(connectionWarning(state)).toBe(null);
  });

  it("warns that the instance signed the app out", () => {
    const state: ConnectionState = {
      kind: "signed-out",
      url: URL_TEXT,
      user: USER,
      reason: "Metabase ended this app's sign-in.",
    };
    expect(connectionWarning(state)).toBe("Signed out of Metabase");
  });

  it("says nothing before the app has ever connected", () => {
    expect(connectionWarning({ kind: "disconnected" })).toBe(null);
  });
});
