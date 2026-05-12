import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, ValidationError } from "../core/errors";
import { parseYaml, parseYamlResult, stringifyYaml } from "./yaml";

const Envelope = z.object({
  version: z.number(),
  config: z.object({ name: z.string() }),
});

describe("parseYaml", () => {
  it("parses valid YAML matching the schema", () => {
    const yaml = "version: 1\nconfig:\n  name: ws\n";
    expect(parseYaml(yaml, Envelope)).toEqual({ version: 1, config: { name: "ws" } });
  });

  it("throws ConfigError mentioning the source on malformed YAML", () => {
    const broken = "version: 1\nconfig: [unclosed";
    let thrown: unknown;
    try {
      parseYaml(broken, Envelope, { source: "config.yml" });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    if (!(thrown instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(thrown.message.startsWith("config.yml: invalid YAML: ")).toBe(true);
  });

  it("throws ValidationError when the schema rejects the parsed value", () => {
    const yaml = "version: 1\nconfig:\n  name: 99\n";
    let thrown: unknown;
    try {
      parseYaml(yaml, Envelope, { source: "config.yml" });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    if (!(thrown instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(thrown.developerDetail.source).toBe("config.yml");
  });
});

describe("parseYamlResult", () => {
  it("returns ok with the parsed value", () => {
    expect(parseYamlResult("version: 2\nconfig:\n  name: x\n", Envelope)).toEqual({
      ok: true,
      value: { version: 2, config: { name: "x" } },
    });
  });

  it("returns a ConfigError on broken YAML", () => {
    const result = parseYamlResult("a: [b: c", Envelope, { source: "fixture" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error).toBeInstanceOf(ConfigError);
    expect(result.error.message.startsWith("fixture: invalid YAML: ")).toBe(true);
  });
});

describe("stringifyYaml", () => {
  it("round-trips simple structures", () => {
    const value = { version: 1, config: { name: "ws", databases: [{ id: 1 }, { id: 2 }] } };
    const yaml = stringifyYaml(value);
    expect(parseYamlResult(yaml, z.unknown())).toEqual({ ok: true, value });
  });

  it("emits flow-style-free output suitable for human reading", () => {
    const yaml = stringifyYaml({ a: 1, b: [1, 2] });
    expect(yaml).toBe("a: 1\nb:\n  - 1\n  - 2\n");
  });
});
