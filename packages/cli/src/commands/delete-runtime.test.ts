import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";
import type { Client } from "../core/http/client";

import type { CommonContext } from "./context";
import { confirmAndDelete } from "./delete-runtime";

const NEVER_CALL: Client = {
  async requestParsed() {
    throw new Error("requestParsed must not be called");
  },
  async requestRaw() {
    throw new Error("requestRaw must not be called");
  },
  async requestStream() {
    throw new Error("requestStream must not be called");
  },
};

const CTX: CommonContext = {
  format: "json",
  full: false,
  fields: undefined,
  maxBytes: 0,
  url: undefined,
  apiKey: undefined,
  profile: undefined,
  skipPreflight: false,
};

describe("confirmAndDelete", () => {
  it("refuses without --yes when stdin is not a TTY and never reaches the server", async () => {
    const error = await confirmAndDelete({
      id: 99999999,
      path: "/api/transform/99999999",
      yes: false,
      promptMessage: "Delete transform 99999999?",
      successMessage: "Deleted transform 99999999.",
      abortMessage: "Aborted; transform 99999999 was not deleted.",
      client: NEVER_CALL,
      ctx: CTX,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "refusing to delete 99999999 without confirmation — pass --yes to proceed non-interactively",
    );
    expect(error.exitCode).toBe(2);
  });
});
