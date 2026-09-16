import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ConfigError } from "../errors";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SETTING = {
  key: "site-name",
  value: "Acme Analytics",
  is_env_setting: false,
  env_name: "MB_SITE_NAME",
  description: "The name used for this instance of Metabase.",
  default: "Metabase",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_WRITE_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

// Metabase rejects an unknown key with a 400 that names it as a Clojure keyword.
const UNKNOWN_SETTING_RESPONSE = { message: "Unknown setting: :totally-bogus" };

// The server encodes a setting's value by its runtime type: a string arrives bare as text/plain,
// everything else under application/json — a keyword as its bare name, the rest as JSON.
function wireResponse(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

const JSON_CHARSET_CONTENT_TYPE = "application/json;charset=utf-8";

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("setting resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse([SETTING])]);

    await mb.setting.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setting",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("percent-encodes the key into the get path", async () => {
    const { mb, capture } = clientOver([jsonResponse("main")]);

    await mb.setting.get("branch/name with space");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setting/branch%2Fname%20with%20space",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads an unset setting's 204 as a null value", async () => {
    const { mb } = clientOver([new Response(null, { status: 204 })]);

    expect(await mb.setting.get("remote-sync-branch")).toBeNull();
  });

  it("reads a string setting's bare text/plain body as the string", async () => {
    const { mb } = clientOver([wireResponse("admin@e2e.test", "text/plain")]);

    expect(await mb.setting.get("admin-email")).toBe("admin@e2e.test");
  });

  it("keeps a string setting's text/plain body a string even when it reads as JSON", async () => {
    const { mb } = clientOver([wireResponse("123", "text/plain")]);

    expect(await mb.setting.get("email-from-name")).toBe("123");
  });

  it("reads a boolean setting's JSON literal as the boolean", async () => {
    const { mb } = clientOver([wireResponse("false", JSON_CHARSET_CONTENT_TYPE)]);

    expect(await mb.setting.get("enable-public-sharing")).toBe(false);
  });

  it("reads a numeric setting's JSON literal as the number", async () => {
    const { mb } = clientOver([wireResponse("15152.63298", JSON_CHARSET_CONTENT_TYPE)]);

    expect(await mb.setting.get("startup-time-millis")).toBe(15152.63298);
  });

  it("reads a keyword setting's bare name under application/json as the string", async () => {
    const { mb } = clientOver([wireResponse("strict", JSON_CHARSET_CONTENT_TYPE)]);

    expect(await mb.setting.get("session-cookie-samesite")).toBe("strict");
  });

  it("reads a JSON setting's document as the parsed value", async () => {
    const { mb } = clientOver([
      wireResponse(
        '{"us_states":{"name":"United States","builtin":true}}',
        JSON_CHARSET_CONTENT_TYPE,
      ),
    ]);

    expect(await mb.setting.get("custom-geojson")).toEqual({
      us_states: { name: "United States", builtin: true },
    });
  });

  it("percent-encodes the key into the set path and wraps the value in the body", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.setting.set("branch/name with space", "main");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setting/branch%2Fname%20with%20space",
        method: "PUT",
        headers: BINARY_WRITE_HEADERS,
        body: '{"value":"main"}',
      },
    ]);
  });

  it("rewrites a get against an unknown key to name the caller's key without the keyword colon", async () => {
    const { mb } = clientOver([jsonResponse(UNKNOWN_SETTING_RESPONSE, 400)]);

    const error = await thrownBy(() => mb.setting.get("totally-bogus"));

    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("unknown setting: totally-bogus");
  });

  it("rewrites a set against an unknown key the same way", async () => {
    const { mb } = clientOver([jsonResponse(UNKNOWN_SETTING_RESPONSE, 400)]);

    const error = await thrownBy(() => mb.setting.set("totally-bogus", "main"));

    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("unknown setting: totally-bogus");
  });

  it("rethrows a get failure that is not an unknown-setting answer unchanged", async () => {
    const { mb } = clientOver([jsonResponse({ message: "boom" }, 500)]);

    const error = await thrownBy(() => mb.setting.get("site-name", { retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.message).toBe("boom");
    expect(error.status).toBe(500);
  });

  it("rethrows a set failure that is not an unknown-setting answer unchanged", async () => {
    const { mb } = clientOver([jsonResponse({ message: "boom" }, 500)]);

    const error = await thrownBy(() => mb.setting.set("site-name", "Acme", { retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.message).toBe("boom");
    expect(error.status).toBe(500);
  });
});
