import { describe, expect, it } from "vitest";

import { resolveCommonFlags } from "./context";
import { ConfigError } from "../core/errors";

describe("resolveCommonFlags — format reconciliation", () => {
  it("forces format=json when --json is passed", () => {
    const result = resolveCommonFlags({ json: true }, { isTty: true });
    expect(result.format).toBe("json");
  });

  it("accepts --json with --format json (no conflict)", () => {
    const result = resolveCommonFlags({ json: true, format: "json" }, { isTty: true });
    expect(result.format).toBe("json");
  });

  it("throws ConfigError when --json conflicts with --format text", () => {
    expect(() => resolveCommonFlags({ json: true, format: "text" }, { isTty: true })).toThrow(
      new ConfigError("--json conflicts with --format text"),
    );
  });

  it("treats --json with --format auto as no conflict (auto is not concrete)", () => {
    const result = resolveCommonFlags({ json: true, format: "auto" }, { isTty: true });
    expect(result.format).toBe("json");
  });

  it("uses --format json when set explicitly", () => {
    const result = resolveCommonFlags({ format: "json" }, { isTty: true });
    expect(result.format).toBe("json");
  });

  it("uses --format text when set explicitly", () => {
    const result = resolveCommonFlags({ format: "text" }, { isTty: false });
    expect(result.format).toBe("text");
  });

  it("resolves --format auto to text when stdout is a TTY", () => {
    const result = resolveCommonFlags({ format: "auto" }, { isTty: true });
    expect(result.format).toBe("text");
  });

  it("resolves --format auto to json when stdout is piped", () => {
    const result = resolveCommonFlags({ format: "auto" }, { isTty: false });
    expect(result.format).toBe("json");
  });

  it("defaults to auto resolution when format is undefined", () => {
    const tty = resolveCommonFlags({}, { isTty: true });
    expect(tty.format).toBe("text");
    const pipe = resolveCommonFlags({}, { isTty: false });
    expect(pipe.format).toBe("json");
  });

  it("throws ConfigError on invalid --format value", () => {
    expect(() => resolveCommonFlags({ format: "yaml" }, { isTty: true })).toThrow(
      new ConfigError(`invalid --format value: "yaml" (expected: auto, json, text)`),
    );
  });
});

describe("resolveCommonFlags — full / fields reconciliation", () => {
  it("defaults to compact (full=false, fields=undefined)", () => {
    const result = resolveCommonFlags({}, { isTty: true });
    expect(result.full).toBe(false);
    expect(result.fields).toBeUndefined();
  });

  it("--full sets full=true", () => {
    expect(resolveCommonFlags({ full: true }, { isTty: true }).full).toBe(true);
  });

  it("--fields populates fields and leaves full=false", () => {
    const result = resolveCommonFlags({ fields: "id,name" }, { isTty: true });
    expect(result.full).toBe(false);
    expect(result.fields).toEqual(["id", "name"]);
  });

  it("throws ConfigError when --full and --fields are combined", () => {
    expect(() => resolveCommonFlags({ full: true, fields: "id" }, { isTty: true })).toThrow(
      new ConfigError("--full conflicts with --fields (use one or neither)"),
    );
  });

  it("treats --full=false as not set", () => {
    expect(resolveCommonFlags({ full: false }, { isTty: true }).full).toBe(false);
  });
});

describe("resolveCommonFlags — fields CSV parsing", () => {
  it("returns undefined when fields is omitted", () => {
    expect(resolveCommonFlags({}, { isTty: true }).fields).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveCommonFlags({ fields: "" }, { isTty: true }).fields).toBeUndefined();
  });

  it("splits CSV, trims whitespace, drops empty entries", () => {
    const result = resolveCommonFlags({ fields: "id, name , , description" }, { isTty: true });
    expect(result.fields).toEqual(["id", "name", "description"]);
  });

  it("returns undefined when CSV contains only whitespace and commas", () => {
    expect(resolveCommonFlags({ fields: " , , " }, { isTty: true }).fields).toBeUndefined();
  });
});

describe("resolveCommonFlags — maxBytes parsing", () => {
  it("uses default 65536 when omitted", () => {
    expect(resolveCommonFlags({}, { isTty: true }).maxBytes).toBe(65536);
  });

  it("parses '0' as 0 (disables cap)", () => {
    expect(resolveCommonFlags({ maxBytes: "0" }, { isTty: true }).maxBytes).toBe(0);
  });

  it("parses positive integer string", () => {
    expect(resolveCommonFlags({ maxBytes: "1024" }, { isTty: true }).maxBytes).toBe(1024);
  });

  it("throws ConfigError on negative value", () => {
    expect(() => resolveCommonFlags({ maxBytes: "-1" }, { isTty: true })).toThrow(
      new ConfigError("invalid --max-bytes value: -1 (must be non-negative)"),
    );
  });

  it("throws ConfigError on non-integer string", () => {
    expect(() => resolveCommonFlags({ maxBytes: "abc" }, { isTty: true })).toThrow(
      new ConfigError(`invalid --max-bytes value: "abc" (expected non-negative integer)`),
    );
  });

  it("throws ConfigError on float", () => {
    expect(() => resolveCommonFlags({ maxBytes: "1.5" }, { isTty: true })).toThrow(
      new ConfigError(`invalid --max-bytes value: "1.5" (expected non-negative integer)`),
    );
  });
});

describe("resolveCommonFlags — full result shape", () => {
  it("returns fully-defaulted context for empty args on a TTY", () => {
    expect(resolveCommonFlags({}, { isTty: true })).toEqual({
      format: "text",
      full: false,
      fields: undefined,
      maxBytes: 65536,
      url: undefined,
      apiKey: undefined,
      profile: undefined,
    });
  });

  it("forwards every populated field unchanged into the resolved context", () => {
    const result = resolveCommonFlags(
      {
        url: "https://m.example.com",
        apiKey: "secret",
        profile: "prod",
        format: "text",
        fields: "id,name",
        maxBytes: "1024",
      },
      { isTty: false },
    );
    expect(result).toEqual({
      format: "text",
      full: false,
      fields: ["id", "name"],
      maxBytes: 1024,
      url: "https://m.example.com",
      apiKey: "secret",
      profile: "prod",
    });
  });
});
