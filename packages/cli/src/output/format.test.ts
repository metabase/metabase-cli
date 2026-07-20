import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";
import { resolveFormat } from "./format";

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
