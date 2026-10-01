import { ConfigError } from "../errors";

import { isCallbackPath, parseCallbackQuery, stripPasteArtifacts } from "./callback-server";

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface PastedCode {
  kind: "code";
  code: string;
}

export interface PastedDenial {
  kind: "denied";
  error: ConfigError;
}

export interface PastedInvalid {
  kind: "invalid";
  reason: string;
}

export type PastedRedirect = PastedCode | PastedDenial | PastedInvalid;

interface SplitRedirect {
  path: string | null;
  query: string;
}

function invalid(reason: string): PastedInvalid {
  return { kind: "invalid", reason };
}

function wrongPathReason(path: string): string {
  const expected = "expected the redirect URL ending in /callback";
  return path === "" ? expected : `${expected}, got a URL with path "${path}"`;
}

function withoutFragment(value: string): string {
  const hash = value.indexOf("#");
  return hash === -1 ? value : value.slice(0, hash);
}

function pathOf(location: string): string {
  const authorityAndPath = location.replace(SCHEME_PATTERN, "");
  const slash = authorityAndPath.indexOf("/");
  return slash === -1 ? "" : authorityAndPath.slice(slash);
}

function splitRedirect(cleaned: string): SplitRedirect | null {
  const queryStart = cleaned.indexOf("?");
  if (queryStart !== -1) {
    return { path: pathOf(cleaned.slice(0, queryStart)), query: cleaned.slice(queryStart + 1) };
  }
  if (cleaned.includes("=")) {
    return { path: null, query: cleaned };
  }
  return null;
}

// Reads what a user pasted back from the browser that completed consent: the full redirect URL
// (with or without its scheme) or its bare query string, held to the same state check the loopback
// server applies. A lone code is refused: it carries no state to check, and a stray word typed at
// the prompt would otherwise end the login in a failed token exchange instead of a second try.
export function parsePastedRedirect(input: string, expectedState: string): PastedRedirect {
  const cleaned = withoutFragment(stripPasteArtifacts(input));
  if (cleaned === "") {
    return invalid("paste the URL your browser was redirected to");
  }
  const split = splitRedirect(cleaned);
  if (split === null) {
    return invalid("that is not a redirect URL; expected one ending in /callback?code=…&state=…");
  }
  const params = new URLSearchParams(split.query);
  if (params.has("response_type")) {
    return invalid(
      "that is the authorization URL; open it in a browser, approve, then paste the URL the browser is redirected to",
    );
  }
  if (split.path !== null && !isCallbackPath(split.path)) {
    return invalid(wrongPathReason(split.path));
  }
  const query = parseCallbackQuery(`?${split.query}`);
  if (query.state === null) {
    return invalid("the pasted URL has no state parameter; paste the full redirect URL");
  }
  if (query.state !== expectedState) {
    return invalid(
      "the pasted URL's state does not match this login; it belongs to a different or earlier attempt",
    );
  }
  if (query.error !== null) {
    const detail = query.errorDescription ?? query.error;
    return { kind: "denied", error: new ConfigError(`authorization denied: ${detail}`) };
  }
  if (query.code === null) {
    return invalid("the pasted URL has no authorization code");
  }
  return { kind: "code", code: query.code };
}
