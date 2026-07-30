import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseJson } from "../json";
import { CurrentUser } from "./user";

const samplePath = fileURLToPath(new URL("../../tests/fixtures/user/sample.json", import.meta.url));

describe("CurrentUser", () => {
  it("parses the sample fixture", () => {
    expect(parseJson(readFileSync(samplePath, "utf8"), CurrentUser)).toEqual({
      id: 7,
      email: "alice@example.com",
      common_name: "Alice Example",
      is_superuser: true,
    });
  });

  it("preserves unknown fields via passthrough", () => {
    const parsed = CurrentUser.parse({
      id: 7,
      email: "alice@example.com",
      common_name: "Alice Example",
      is_superuser: false,
      first_name: "Alice",
      experimental_flag: true,
    });
    expect(parsed).toEqual({
      id: 7,
      email: "alice@example.com",
      common_name: "Alice Example",
      is_superuser: false,
      first_name: "Alice",
      experimental_flag: true,
    });
  });
});
