import { describe, expect, it } from "vitest";

import { escapeJsonPointerSegment } from "./json-pointer";

describe("escapeJsonPointerSegment", () => {
  it("returns plain string keys unchanged when they contain no RFC 6901 reserved chars", () => {
    expect(escapeJsonPointerSegment("data")).toBe("data");
  });

  it("escapes tilde as ~0 before slash as ~1 so order-sensitivity matches RFC 6901", () => {
    expect(escapeJsonPointerSegment("a~/b")).toBe("a~0~1b");
  });

  it("renders numeric array indices as bare decimals without escaping", () => {
    expect(escapeJsonPointerSegment(3)).toBe("3");
  });

  it("stringifies symbol keys for safe rendering", () => {
    expect(escapeJsonPointerSegment(Symbol("anonymous"))).toBe("Symbol(anonymous)");
  });
});
