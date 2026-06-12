import { z } from "zod";

import type { OAuthCredential } from "../../../src/core/auth/credential";
import { writeOAuthProfile } from "../../../src/core/auth/storage";
import { CurrentUser } from "../../../src/domain/user";
import { parseJson } from "../../../src/runtime/json";
import type { E2EBootstrap } from "../bootstrap-data";

// Browser-simulation and raw-protocol helpers for the OAuth e2e suite. They live under setup/
// because they speak HTTP to Metabase directly — the sanctioned home for fetch in the e2e tier:
// they stand in for the browser the CLI would open, and probe protocol-level outcomes (bearer
// acceptance, revoked-grant rejection) that no CLI command exposes.

const SessionResponse = z.object({ id: z.string() });

type AdminCredentials = E2EBootstrap["admin"];

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Simulates the browser the CLI would open: log in, render the consent page, approve it, and let
// the server redirect the authorization code to the CLI's loopback callback.
export function consentingBrowser(
  baseUrl: string,
  admin: AdminCredentials,
): (authorizeUrl: string) => Promise<boolean> {
  return async (authorizeUrl: string): Promise<boolean> => {
    const sessionRes = await fetch(`${baseUrl}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: admin.email, password: admin.password }),
    });
    const sessionId = parseJson(await sessionRes.text(), SessionResponse, {
      source: "/api/session",
    }).id;

    const authRes = await fetch(authorizeUrl, {
      headers: { "x-metabase-session": sessionId },
      redirect: "manual",
    });
    const cookie = (authRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const html = await authRes.text();
    const fields: Record<string, string> = {};
    for (const tag of html.match(/<input[^>]*>/gi) ?? []) {
      const name = tag.match(/name="([^"]*)"/i)?.[1];
      const value = tag.match(/value="([^"]*)"/i)?.[1];
      if (name !== undefined) {
        fields[name] = decodeHtmlAttr(value ?? "");
      }
    }

    const decisionRes = await fetch(`${baseUrl}/oauth/authorize/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-metabase-session": sessionId,
        cookie,
      },
      body: new URLSearchParams({ ...fields, approved: "true" }),
      redirect: "manual",
    });
    const location = decisionRes.headers.get("location");
    if (location === null) {
      throw new Error(`consent decision did not redirect (status ${decisionRes.status})`);
    }
    // Hitting the loopback callback delivers the code+state to the CLI's callback server.
    await fetch(location);
    return true;
  };
}

// GET /api/user/current with a bearer token; throws with status and body context when rejected.
export async function fetchCurrentUserWithBearer(
  baseUrl: string,
  accessToken: string,
): Promise<CurrentUser> {
  const res = await fetch(`${baseUrl}/api/user/current`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/user/current with bearer token failed (${res.status}): ${await res.text()}`,
    );
  }
  return parseJson(await res.text(), CurrentUser, { source: "/api/user/current" });
}

// Replay a refresh grant directly against /oauth/token, returning the HTTP status — lets a test
// assert a revoked refresh token is rejected (400 invalid_grant) without a CLI command for it.
export async function refreshGrantStatus(
  baseUrl: string,
  credential: OAuthCredential,
): Promise<number> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: credential.clientId,
    }),
  });
  await res.text();
  return res.status;
}

// Persist an OAuth credential into an isolated config home (plaintext file, never the host
// keychain) so a CLI subprocess pointed at the same home reads the same credential.
export async function writeOAuthProfileIntoConfigHome(
  configHome: string,
  baseUrl: string,
  credential: OAuthCredential,
): Promise<void> {
  const prevXdg = process.env["XDG_CONFIG_HOME"];
  const prevKeyring = process.env["METABASE_CLI_DISABLE_KEYRING"];
  process.env["XDG_CONFIG_HOME"] = configHome;
  process.env["METABASE_CLI_DISABLE_KEYRING"] = "1";
  try {
    await writeOAuthProfile(baseUrl, credential);
  } finally {
    restoreEnv("XDG_CONFIG_HOME", prevXdg);
    restoreEnv("METABASE_CLI_DISABLE_KEYRING", prevKeyring);
  }
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}
