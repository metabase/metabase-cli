import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "../errors";

import { parsePastedRedirect } from "./pasted-redirect";

const STATE = "the-state";
const REDIRECT = "http://127.0.0.1:46441/callback";

describe("parsePastedRedirect", () => {
  it("reads the code from the full redirect URL", () => {
    expect(parsePastedRedirect(`${REDIRECT}?code=the-code&state=${STATE}`, STATE)).toEqual({
      kind: "code",
      code: "the-code",
    });
  });

  it("ignores the RFC 9207 iss parameter Metabase appends", () => {
    const pasted = `${REDIRECT}?code=the-code&iss=https%3A%2F%2Fmb.example.com&state=${STATE}`;
    expect(parsePastedRedirect(pasted, STATE)).toEqual({ kind: "code", code: "the-code" });
  });

  it("undoes zsh url-quote-magic's backslash escapes", () => {
    const pasted = `${REDIRECT}\\?code\\=the-code\\&iss\\=https%3A%2F%2Fmb.example.com\\&state\\=${STATE}`;
    expect(parsePastedRedirect(pasted, STATE)).toEqual({ kind: "code", code: "the-code" });
  });

  it("drops whitespace, including the line breaks of a wrapped copy", () => {
    const pasted = `  ${REDIRECT}?code=the-\n  code&state=${STATE}\r\n`;
    expect(parsePastedRedirect(pasted, STATE)).toEqual({ kind: "code", code: "the-code" });
  });

  it("accepts a trailing slash after /callback", () => {
    expect(parsePastedRedirect(`${REDIRECT}/?code=the-code&state=${STATE}`, STATE)).toEqual({
      kind: "code",
      code: "the-code",
    });
  });

  it("accepts the URL without its scheme", () => {
    expect(
      parsePastedRedirect(`127.0.0.1:46441/callback?code=the-code&state=${STATE}`, STATE),
    ).toEqual({ kind: "code", code: "the-code" });
  });

  it("ignores a fragment", () => {
    expect(parsePastedRedirect(`${REDIRECT}?code=the-code&state=${STATE}#_`, STATE)).toEqual({
      kind: "code",
      code: "the-code",
    });
  });

  it("accepts the bare query string", () => {
    expect(parsePastedRedirect(`code=the-code&state=${STATE}`, STATE)).toEqual({
      kind: "code",
      code: "the-code",
    });
  });

  it("refuses the authorization code alone, which carries no state to check", () => {
    expect(parsePastedRedirect(" the-code\n", STATE)).toEqual({
      kind: "invalid",
      reason: "that is not a redirect URL; expected one ending in /callback?code=…&state=…",
    });
  });

  it("rejects a redirect from another login attempt by its state", () => {
    expect(parsePastedRedirect(`${REDIRECT}?code=the-code&state=other`, STATE)).toEqual({
      kind: "invalid",
      reason:
        "the pasted URL's state does not match this login; it belongs to a different or earlier attempt",
    });
  });

  it("rejects a redirect without a state", () => {
    expect(parsePastedRedirect(`${REDIRECT}?code=the-code`, STATE)).toEqual({
      kind: "invalid",
      reason: "the pasted URL has no state parameter; paste the full redirect URL",
    });
  });

  it("rejects a redirect without a code", () => {
    expect(parsePastedRedirect(`${REDIRECT}?state=${STATE}`, STATE)).toEqual({
      kind: "invalid",
      reason: "the pasted URL has no authorization code",
    });
  });

  it("points out that the authorization URL was pasted instead of the redirect", () => {
    const pasted = `https://mb.example.com/oauth/authorize?response_type=code&client_id=c&state=${STATE}`;
    expect(parsePastedRedirect(pasted, STATE)).toEqual({
      kind: "invalid",
      reason:
        "that is the authorization URL; open it in a browser, approve, then paste the URL the browser is redirected to",
    });
  });

  it("rejects a URL whose path is not the callback", () => {
    expect(
      parsePastedRedirect(`http://127.0.0.1:46441/other?code=the-code&state=${STATE}`, STATE),
    ).toEqual({
      kind: "invalid",
      reason: 'expected the redirect URL ending in /callback, got a URL with path "/other"',
    });
  });

  it("rejects a URL with no path at all", () => {
    expect(parsePastedRedirect(`callback?code=the-code&state=${STATE}`, STATE)).toEqual({
      kind: "invalid",
      reason: "expected the redirect URL ending in /callback",
    });
  });

  it("checks the state before honouring a denial, so a forged one cannot end the login", () => {
    expect(parsePastedRedirect(`${REDIRECT}?error=access_denied&state=forged`, STATE)).toEqual({
      kind: "invalid",
      reason:
        "the pasted URL's state does not match this login; it belongs to a different or earlier attempt",
    });
  });

  it("rejects input that is not a URL", () => {
    expect(parsePastedRedirect("not a url!", STATE)).toEqual({
      kind: "invalid",
      reason: "that is not a redirect URL; expected one ending in /callback?code=…&state=…",
    });
  });

  it("rejects an empty paste", () => {
    expect(parsePastedRedirect("  \n", STATE)).toEqual({
      kind: "invalid",
      reason: "paste the URL your browser was redirected to",
    });
  });

  it("reports a denied consent with the provider's description", () => {
    const parsed = parsePastedRedirect(
      `${REDIRECT}?error=access_denied&error_description=User%20said%20no&state=${STATE}`,
      STATE,
    );
    assert(parsed.kind === "denied", "expected a denial");
    expect(parsed.error).toBeInstanceOf(ConfigError);
    expect(parsed.error.message).toBe("authorization denied: User said no");
  });
});
