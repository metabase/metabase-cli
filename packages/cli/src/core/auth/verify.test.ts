import { setImmediate as flushPending } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyCredential } from "@metabase/client/auth/credential";
import { captureFetch, jsonResponse } from "@metabase/client/testing/fetch-capture";

import { USER_AGENT } from "../user-agent";
import { verifyAndProbe } from "./verify";

const CREDENTIAL: ApiKeyCredential = { kind: "apiKey", apiKey: "mb_verify-key" };
const BASE_URL = "https://m.example.com";

const CURRENT_USER = {
  id: 1,
  email: "admin@example.com",
  common_name: "Admin",
  is_superuser: true,
};
const SESSION_PROPERTIES = { version: { tag: "v0.58.0" }, "token-features": { transforms: true } };

const READ_HEADERS = {
  accept: "application/json",
  "user-agent": USER_AGENT,
  "x-api-key": "mb_verify-key",
};

describe("verifyAndProbe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the CLI and its version on every request it issues", async () => {
    const capture = captureFetch([jsonResponse(CURRENT_USER), jsonResponse(SESSION_PROPERTIES)]);
    vi.stubGlobal("fetch", capture.fetch);

    await verifyAndProbe(BASE_URL, CREDENTIAL);

    expect(capture.calls.map((call) => call.headers["user-agent"])).toEqual([
      USER_AGENT,
      USER_AGENT,
    ]);
  });

  // The transport's single-flight refresh exists so two concurrent 401s share one token refresh.
  // Serialising the two reads would leave it unexercised, so neither response is answered until
  // both requests have been observed on the wire.
  it("holds the user read and the version probe in flight together", async () => {
    let answer: (() => void) | undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const held = (body: unknown) => async (): Promise<Response> => {
      await answered;
      return jsonResponse(body);
    };
    const capture = captureFetch([held(CURRENT_USER), held(SESSION_PROPERTIES)]);
    vi.stubGlobal("fetch", capture.fetch);

    const pending = verifyAndProbe(BASE_URL, CREDENTIAL);
    try {
      await flushPending();
      expect(capture.calls).toEqual([
        {
          url: `${BASE_URL}/api/user/current`,
          method: "GET",
          headers: READ_HEADERS,
          body: null,
        },
        {
          url: `${BASE_URL}/api/session/properties`,
          method: "GET",
          headers: READ_HEADERS,
          body: null,
        },
      ]);
    } finally {
      answer?.();
    }

    expect(await pending).toEqual({
      ok: true,
      user: { id: 1, name: "Admin", isAdmin: true },
      server: {
        version: { tag: "v0.58.0", major: 58, patch: 0 },
        tokenFeatures: { transforms: true },
      },
    });
  });

  // A transport failure names no route, and a login that reports only "verification failed
  // (current user)" leaves a user unable to tell a blocked route from an unreachable host.
  it("names the request a transport failure never reached", async () => {
    const unreachable = [new TypeError("fetch failed"), new TypeError("fetch failed")];
    const capture = captureFetch(unreachable);
    vi.stubGlobal("fetch", capture.fetch);

    expect(await verifyAndProbe(BASE_URL, CREDENTIAL)).toEqual({
      ok: false,
      which: "user",
      kind: "network",
      endpoint: `${BASE_URL}/api/user/current`,
      message: "Could not reach Metabase: fetch failed",
    });
  });
});
