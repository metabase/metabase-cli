import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";
import { plural, qualifiedName, resolveFormat } from "./format";

describe("resolveFormat", () => {
  it("forces json when --json is set", () => {
    expect(resolveFormat({ json: true, format: undefined, isTty: true })).toBe("json");
    expect(resolveFormat({ json: true, format: "auto", isTty: true })).toBe("json");
    expect(resolveFormat({ json: true, format: "json", isTty: true })).toBe("json");
  });

  it("rejects invalid --format value", () => {
    expect(() => resolveFormat({ json: false, format: "yaml", isTty: true })).toThrow(
      new ConfigError(`invalid --format value: "yaml" (expected: auto, json, text)`),
    );
  });

  it("rejects --json combined with --format text", () => {
    expect(() => resolveFormat({ json: true, format: "text", isTty: true })).toThrow(
      new ConfigError("--json conflicts with --format text"),
    );
  });

  it("returns explicit --format value", () => {
    expect(resolveFormat({ json: false, format: "json", isTty: true })).toBe("json");
    expect(resolveFormat({ json: false, format: "text", isTty: false })).toBe("text");
  });

  it("auto resolves to text on TTY and json off TTY", () => {
    expect(resolveFormat({ json: undefined, format: "auto", isTty: true })).toBe("text");
    expect(resolveFormat({ json: undefined, format: "auto", isTty: false })).toBe("json");
    expect(resolveFormat({ json: undefined, format: undefined, isTty: true })).toBe("text");
    expect(resolveFormat({ json: undefined, format: undefined, isTty: false })).toBe("json");
  });
});

describe("plural", () => {
  it("leaves the noun singular for exactly one and pluralizes every other count", () => {
    expect([plural(0, "table"), plural(1, "table"), plural(2, "table")]).toEqual([
      "0 tables",
      "1 table",
      "2 tables",
    ]);
  });
});

describe("qualifiedName", () => {
  it("prefixes the schema when there is one and leaves a bare name otherwise", () => {
    expect([
      qualifiedName("public", "orders"),
      qualifiedName(null, "orders"),
      qualifiedName(undefined, "orders"),
    ]).toEqual(["public.orders", "orders", "orders"]);
  });
});
