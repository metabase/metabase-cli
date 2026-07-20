import { describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";

import { parseCollectionRef } from "./parse-ref";

describe("parseCollectionRef", () => {
  it("accepts a positive integer string and returns the trimmed digits", () => {
    expect(parseCollectionRef("42")).toBe("42");
    expect(parseCollectionRef("  42  ")).toBe("42");
    expect(parseCollectionRef("1")).toBe("1");
  });

  it('accepts "root" and "trash" as canonical literals', () => {
    expect(parseCollectionRef("root")).toBe("root");
    expect(parseCollectionRef("trash")).toBe("trash");
  });

  it("accepts a 21-character NanoID-shaped entity id", () => {
    expect(parseCollectionRef("voo1If9y8Sld0lXej6xl0")).toBe("voo1If9y8Sld0lXej6xl0");
    expect(parseCollectionRef("trashtrashtrashtrasht")).toBe("trashtrashtrashtrasht");
    expect(parseCollectionRef("A_B-c0123456789defghi")).toBe("A_B-c0123456789defghi");
  });

  it("rejects an empty string with ConfigError citing the accepted formats", () => {
    expect(() => parseCollectionRef("")).toThrow(ConfigError);
    expect(() => parseCollectionRef("")).toThrow(
      'invalid id: "" (expected integer, "root", "trash", or 21-char entity id)',
    );
  });

  it("rejects zero and negative integers", () => {
    expect(() => parseCollectionRef("0")).toThrow(ConfigError);
    expect(() => parseCollectionRef("0")).toThrow(
      'invalid id: "0" (expected integer, "root", "trash", or 21-char entity id)',
    );
    expect(() => parseCollectionRef("-1")).toThrow(ConfigError);
    expect(() => parseCollectionRef("-1")).toThrow(
      'invalid id: "-1" (expected integer, "root", "trash", or 21-char entity id)',
    );
  });

  it("rejects 21-char strings with disallowed characters", () => {
    expect(() => parseCollectionRef("voo1If9y8Sld0lXej6xl@")).toThrow(ConfigError);
    expect(() => parseCollectionRef("voo1If9y8Sld0lXej6xl@")).toThrow(
      'invalid id: "voo1If9y8Sld0lXej6xl@" (expected integer, "root", "trash", or 21-char entity id)',
    );
  });

  it.each([
    ["rooty", 'invalid id: "rooty" (expected integer, "root", "trash", or 21-char entity id)'],
    ["trashy", 'invalid id: "trashy" (expected integer, "root", "trash", or 21-char entity id)'],
    ["abc", 'invalid id: "abc" (expected integer, "root", "trash", or 21-char entity id)'],
    [
      "voo1If9y8Sld0lXej6xl",
      'invalid id: "voo1If9y8Sld0lXej6xl" (expected integer, "root", "trash", or 21-char entity id)',
    ],
    [
      "voo1If9y8Sld0lXej6xl00",
      'invalid id: "voo1If9y8Sld0lXej6xl00" (expected integer, "root", "trash", or 21-char entity id)',
    ],
  ])("rejects %j with the canonical format-hint message", (input, expectedMessage) => {
    expect(() => parseCollectionRef(input)).toThrow(ConfigError);
    expect(() => parseCollectionRef(input)).toThrow(expectedMessage);
  });
});
