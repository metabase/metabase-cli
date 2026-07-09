import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import logoutCommand from "./logout";
import type { OAuthCredential } from "../../core/auth/credential";
import {
  captureFetch,
  jsonResponse,
  type CapturedFetchCall,
  type FetchScript,
} from "../../core/http/fetch-capture";
import type { OAuthServerMetadata } from "../../core/http/oauth";
import {
  KEYCHAIN_RESIDUAL_NOTICE,
  readProfileCredential,
  writeOAuthProfile,
} from "../../core/auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "../../core/auth/temp-config-home";

const OAUTH_CRED: OAuthCredential = {
  kind: "oauth",
  accessToken: "acc-1",
  refreshToken: "ref-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  clientId: "client-1",
  scope: "mb:full",
};

const METADATA: OAuthServerMetadata = {
  issuer: "https://m.example.com",
  authorization_endpoint: "https://m.example.com/oauth/authorize",
  token_endpoint: "https://m.example.com/oauth/token",
  revocation_endpoint: "https://m.example.com/oauth/revoke",
};

function installFetch(script: FetchScript): CapturedFetchCall[] {
  const capture = captureFetch(script);
  vi.stubGlobal("fetch", capture.fetch);
  return capture.calls;
}

describe("auth logout command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    hoisted.controls.broken = false;
    home.cleanup();
  });

  // Plain api-key logout (clear + cleared:false + non-interactive auto-confirm) is covered against
  // a real Metabase by the auth e2e suite. These unit tests cover only the OAuth-specific
  // revoke/keychain behavior, which the e2e tier doesn't drive through the CLI (an OAuth login
  // subprocess would need a real browser).

  it("revokes both OAuth tokens server-side (refresh first), then clears the profile", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH_CRED);
    const calls = installFetch([
      jsonResponse(METADATA),
      new Response("", { status: 200 }),
      new Response("", { status: 200 }),
    ]);

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(logoutCommand, { rawArgs: ["--profile", "default", "--yes"] });

    const revokes = calls.filter((call) => call.url === "https://m.example.com/oauth/revoke");
    expect(revokes.map((call) => call.body)).toEqual([
      new URLSearchParams({ token: "ref-1", client_id: "client-1" }).toString(),
      new URLSearchParams({ token: "acc-1", client_id: "client-1" }).toString(),
    ]);
    expect(await readProfileCredential()).toBeNull();
  });

  it("still clears locally when server-side revocation fails", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH_CRED);
    installFetch([jsonResponse(METADATA), jsonResponse({ error: "server_error" }, 500)]);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(logoutCommand, { rawArgs: ["--profile", "default", "--yes"] });

    expect(await readProfileCredential()).toBeNull(); // logout is not blocked by a revoke failure
    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).toContain("could not revoke tokens server-side");
  });

  it("warns and skips revocation when the server advertises no revocation endpoint", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH_CRED);
    const { revocation_endpoint: _omit, ...withoutRevoke } = METADATA;
    const calls = installFetch([jsonResponse(withoutRevoke)]);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(logoutCommand, { rawArgs: ["--profile", "default", "--yes"] });

    expect(calls.some((call) => call.url.includes("/oauth/revoke"))).toBe(false);
    expect(await readProfileCredential()).toBeNull();
    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).toContain(
      "server does not advertise a revocation endpoint; tokens remain valid until they expire",
    );
  });

  it("warns when a keyring-backed token cannot be removed on logout", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH_CRED); // stored in the working keyring
    hoisted.controls.broken = true; // vault refuses both reads and deletes now
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // Keyring is unreadable, so the token can't be revoked server-side; logout still proceeds.
    await runCommand(logoutCommand, { rawArgs: ["--profile", "default", "--yes"] });

    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).toContain(KEYCHAIN_RESIDUAL_NOTICE);
  });
});
