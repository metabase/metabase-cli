import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { FULL_RANGE } from "../output/types";
import type { CommonContext } from "./context";
import { confirmAndDelete } from "./delete-runtime";

function neverDelete(): Promise<void> {
  throw new Error("the resource must not be deleted");
}

const CTX: CommonContext = {
  format: "json",
  full: false,
  fields: undefined,
  maxBytes: 0,
  range: FULL_RANGE,
  url: undefined,
  apiKey: undefined,
  profile: undefined,
  skipPreflight: false,
};

describe("confirmAndDelete", () => {
  it("refuses without --yes when stdin is not a TTY and never reaches the server", async () => {
    const error = await confirmAndDelete({
      id: 99999999,
      yes: false,
      promptMessage: "Delete transform 99999999?",
      successMessage: "Deleted transform 99999999.",
      abortMessage: "Aborted; transform 99999999 was not deleted.",
      deleteResource: neverDelete,
      ctx: CTX,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "refusing to delete 99999999 without confirmation — pass --yes to proceed non-interactively",
    );
  });
});
