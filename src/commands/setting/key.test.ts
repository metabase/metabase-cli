import { describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";
import { HttpError } from "../../core/http/errors";

import { parseSettingKey, rethrowSettingError } from "./key";

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("parseSettingKey", () => {
  it("trims and returns a valid kebab-case key", () => {
    expect(parseSettingKey("  remote-sync-branch  ")).toBe("remote-sync-branch");
  });

  it("rejects a key that is not a kebab-case identifier", () => {
    const error = thrownBy(() => parseSettingKey("not a key!"));
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toBe(
      'invalid setting key: "not a key!" (expected kebab-case identifier)',
    );
    expect(error.exitCode).toBe(2);
  });
});

describe("rethrowSettingError", () => {
  it("rewrites an unknown-setting server error to use the user's key without the keyword colon", () => {
    const serverError = new HttpError({
      status: 400,
      statusText: "Bad Request",
      method: "GET",
      url: "https://m.example.com/api/setting/totally-bogus",
      responseHeaders: new Headers({ "content-type": "application/json" }),
      rawBody: JSON.stringify({ message: "Unknown setting: :totally-bogus" }),
    });

    const error = thrownBy(() => rethrowSettingError(serverError, "totally-bogus"));
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toBe("unknown setting: totally-bogus");
    expect(error.exitCode).toBe(2);
  });

  it("rethrows an unrelated error unchanged", () => {
    const serverError = new HttpError({
      status: 500,
      statusText: "Server Error",
      method: "GET",
      url: "https://m.example.com/api/setting/site-name",
      responseHeaders: new Headers(),
      rawBody: null,
    });

    const error = thrownBy(() => rethrowSettingError(serverError, "site-name"));
    expect(error).toBe(serverError);
  });
});
