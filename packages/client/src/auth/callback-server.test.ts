import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "../errors";

import { startCallbackServer, type CallbackServer } from "./callback-server";

const STATE = "the-state";

async function hit(redirectUri: string, query: string): Promise<Response> {
  return fetch(`${redirectUri}${query}`);
}

async function withServer(fn: (server: CallbackServer) => Promise<void>): Promise<void> {
  const server = await startCallbackServer(STATE);
  try {
    await fn(server);
  } finally {
    server.close();
  }
}

describe("startCallbackServer", () => {
  it("exposes a 127.0.0.1 loopback redirect URI on an ephemeral port", async () => {
    await withServer(async (server) => {
      expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    });
  });

  it("resolves with the code and state from a successful callback", async () => {
    await withServer(async (server) => {
      const pending = server.waitForCallback();
      const response = await hit(server.redirectUri, `?code=the-code&state=${STATE}`);
      expect(response.status).toBe(200);
      expect(await pending).toEqual({ code: "the-code", state: STATE });
    });
  });

  it("rejects when the provider redirects with an error", async () => {
    await withServer(async (server) => {
      const settled = server.waitForCallback().then(
        (): unknown => new Error("expected rejection"),
        (caught: unknown) => caught,
      );
      const response = await hit(
        server.redirectUri,
        `?error=access_denied&error_description=User%20said%20no&state=${STATE}`,
      );
      expect(response.status).toBe(400);
      const error = await settled;
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe("authorization denied: User said no");
    });
  });

  it("rejects a callback missing the code", async () => {
    await withServer(async (server) => {
      const settled = server.waitForCallback().then(
        (): unknown => new Error("expected rejection"),
        (caught: unknown) => caught,
      );
      const response = await hit(server.redirectUri, `?state=${STATE}`);
      expect(response.status).toBe(400);
      const error = await settled;
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe("authorization callback missing code");
    });
  });

  it("ignores a forged callback with the wrong state and resolves only on the genuine one", async () => {
    await withServer(async (server) => {
      const pending = server.waitForCallback();
      const forged = await hit(server.redirectUri, "?code=attacker&state=forged");
      expect(forged.status).toBe(400);
      const genuine = await hit(server.redirectUri, `?code=real-code&state=${STATE}`);
      expect(genuine.status).toBe(200);
      expect(await pending).toEqual({ code: "real-code", state: STATE });
    });
  });

  it("HTML-escapes the attacker-controlled error_description in the response page", async () => {
    await withServer(async (server) => {
      const settled = server.waitForCallback().catch((caught: unknown) => caught);
      const payload = "<script>alert(1)</script>";
      const response = await hit(
        server.redirectUri,
        `?error=access_denied&error_description=${encodeURIComponent(payload)}&state=${STATE}`,
      );
      const body = await response.text();
      expect(body).not.toContain(payload);
      expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      await settled;
    });
  });

  it("rejects with a timeout when no callback arrives within the window", async () => {
    const timeoutMs = 25;
    const server = await startCallbackServer(STATE, timeoutMs);
    try {
      const error = await server.waitForCallback().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe(`timed out waiting for browser login after ${timeoutMs}ms`);
    } finally {
      server.close();
    }
  });

  it("404s requests to paths other than /callback", async () => {
    await withServer(async (server) => {
      const base = server.redirectUri.replace("/callback", "");
      const response = await fetch(`${base}/favicon.ico`);
      expect(response.status).toBe(404);
      await response.text();
    });
  });
});
