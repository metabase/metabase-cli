import { describe, expect, it } from "vitest";

import { authMethodFor, probeAuthMethod } from "./oauth";

const NEVER_ABORTED = new AbortController().signal;

// Port 1 is reserved and nothing listens there, so the connection is refused at once.
const CLOSED_URL = "http://127.0.0.1:1";

describe("probeAuthMethod", () => {
  it("says nothing answered at an address that refuses the connection", async () => {
    expect(await probeAuthMethod(CLOSED_URL, NEVER_ABORTED)).toEqual({
      kind: "unreachable",
      message:
        "Nothing answered at http://127.0.0.1:1. Check the address and that Metabase is running.",
    });
  });
});

describe("authMethodFor", () => {
  it("offers the browser sign-in when discovery finds a usable authorization server", () => {
    expect(
      authMethodFor({
        kind: "found",
        metadata: {
          issuer: "https://mb.example.com",
          authorization_endpoint: "https://mb.example.com/oauth/authorize",
          token_endpoint: "https://mb.example.com/oauth/token",
        },
      }),
    ).toEqual({ kind: "oauth" });
  });

  it("names the status the discovery path answered", () => {
    expect(authMethodFor({ kind: "status", status: 404 })).toEqual({
      kind: "apiKey",
      reason:
        "This Metabase answered 404 when the app looked for its browser sign-in, so paste an API key instead.",
    });
  });

  it("names the content type the discovery path answered", () => {
    expect(authMethodFor({ kind: "notJson", contentType: "text/html;charset=utf-8" })).toEqual({
      kind: "apiKey",
      reason:
        "This Metabase answered with text/html;charset=utf-8 when the app looked for its browser sign-in, so paste an API key instead.",
    });
  });

  it("says the discovery path answered no content type", () => {
    expect(authMethodFor({ kind: "notJson", contentType: null })).toEqual({
      kind: "apiKey",
      reason:
        "This Metabase answered with no content type when the app looked for its browser sign-in, so paste an API key instead.",
    });
  });

  it("counts the narrower scopes and names the first", () => {
    expect(
      authMethodFor({
        kind: "noFullAccessScope",
        offered: ["agent:collection:create", "agent:content:read", "agent:search"],
      }),
    ).toEqual({
      kind: "apiKey",
      reason:
        "This Metabase offers browser sign-in only for 3 narrower scopes such as agent:collection:create, not the full access this app needs, so paste an API key instead.",
    });
  });

  it("names a single narrower scope in the singular", () => {
    expect(authMethodFor({ kind: "noFullAccessScope", offered: ["agent:search"] })).toEqual({
      kind: "apiKey",
      reason:
        "This Metabase offers browser sign-in only for 1 narrower scope such as agent:search, not the full access this app needs, so paste an API key instead.",
    });
  });
});
