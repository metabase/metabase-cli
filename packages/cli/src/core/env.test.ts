import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENV_URL, readEnv } from "./env";

describe("readEnv", () => {
  beforeEach(() => {
    delete process.env["MB_URL"];
  });

  afterEach(() => {
    delete process.env["MB_URL"];
  });

  it("returns undefined when the variable is unset", () => {
    expect(readEnv(ENV_URL)).toBeUndefined();
  });

  it("reads the variable by its MB_ name", () => {
    process.env["MB_URL"] = "https://mb.example.com";
    expect(readEnv(ENV_URL)).toBe("https://mb.example.com");
  });
});
