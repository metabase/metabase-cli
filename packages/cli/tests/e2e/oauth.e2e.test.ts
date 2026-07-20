import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { OAuthCredential } from "../../src/core/auth/credential";
import { oauthLogin } from "../../src/core/auth/oauth-login";
import { refreshOAuthCredential, revokeOAuthCredential } from "../../src/core/auth/oauth-session";
import { AuthProfileListEnvelope } from "../../src/commands/auth/list";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireOAuthServer } from "./server-gate";
import {
  consentingBrowser,
  fetchCurrentUserWithBearer,
  refreshGrantStatus,
  writeOAuthProfileIntoConfigHome,
} from "./setup/oauth-harness";

// The full-API OAuth backend (the session-middleware bearer bridge plus the mb:full scope) ships
// in Metabase v63, so head images have it and the 58–61 matrix stacks don't: ≤59 has no OAuth
// server at all, and 60–62 expose one scoped to the agent API/MCP only — its bearer tokens 401 on
// the REST API. The suite self-skips when bootstrap's live discovery probe found no authorization
// server advertising the full-access scope.
//
// `mb auth login` opens a real browser, so we can't drive it as a subprocess. Instead we run the
// library `oauthLogin()` in-process with an injected "browser" that authenticates as admin and
// completes the consent decision against the live server, then assert the real bearer/refresh/revoke
// lifecycle — the parts unit tests can only mock.

describe.skipIf(requireOAuthServer() !== null)("oauth e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function login(): Promise<OAuthCredential> {
    return oauthLogin(
      { baseUrl: bootstrap.baseUrl },
      {
        openBrowser: consentingBrowser(bootstrap.baseUrl, bootstrap.admin),
        onAuthorizeUrl: () => undefined,
        now: () => Date.now(),
      },
    );
  }

  it("registers a client, completes consent, and the bearer token authenticates the REST API", async () => {
    const credential = await login();
    expect(credential.kind).toBe("oauth");
    expect(credential.accessToken).not.toBe("");
    expect(credential.refreshToken).not.toBe("");
    expect(credential.clientId).not.toBe("");

    const user = await fetchCurrentUserWithBearer(bootstrap.baseUrl, credential.accessToken);
    expect(user.email).toBe(bootstrap.admin.email);
    expect(user.is_superuser).toBe(true);
  });

  it("refreshes the access token against the real token endpoint and the new token works", async () => {
    const credential = await login();
    const refreshed = await refreshOAuthCredential(bootstrap.baseUrl, credential, Date.now());

    expect(refreshed.accessToken).not.toBe(credential.accessToken);
    expect(refreshed.refreshToken).not.toBe(""); // rotation-aware (new or retained)

    const user = await fetchCurrentUserWithBearer(bootstrap.baseUrl, refreshed.accessToken);
    expect(user.email).toBe(bootstrap.admin.email);
  });

  it("revokes both tokens server-side so neither survives logout", async () => {
    const credential = await login();

    const revoked = await revokeOAuthCredential(bootstrap.baseUrl, credential);
    expect(revoked).toBe(true);

    // The revoked grant is rejected outright: 400 invalid_grant.
    expect(await refreshGrantStatus(bootstrap.baseUrl, credential)).toBe(400);
    // The server does not cascade refresh-to-access, so the access token must be dead too.
    await expect(
      fetchCurrentUserWithBearer(bootstrap.baseUrl, credential.accessToken),
    ).rejects.toThrow("failed (401)");
  });

  it("persists the OAuth profile and `auth list` verifies it through the CLI", async () => {
    const credential = await login();
    const configHome = await mkTempConfigHome();
    tempDirs.push(configHome);
    await writeOAuthProfileIntoConfigHome(configHome, bootstrap.baseUrl, credential);

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);
    expect(list.stderr).not.toContain(credential.accessToken);

    const envelope = parseJson(list.stdout, AuthProfileListEnvelope);
    expect(envelope.data).toHaveLength(1);
    expect(envelope.data[0]?.method).toBe("oauth");
    expect(envelope.data[0]?.status).toBe("ok");
    expect(envelope.data[0]?.user?.isAdmin).toBe(true);
  });
});
