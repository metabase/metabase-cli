import { describe, expect, it } from "vitest";

import { normalizeUrl, originOnly } from "./url";

describe("normalizeUrl", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeUrl("https://m.example.com/")).toBe("https://m.example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeUrl("https://m.example.com///")).toBe("https://m.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  https://m.example.com  ")).toBe("https://m.example.com");
  });

  it("rejects URLs without a scheme", () => {
    expect(() => normalizeUrl("m.example.com")).toThrow(/http/);
  });
});

describe("originOnly", () => {
  it("returns the origin for a plain URL", () => {
    expect(originOnly("https://m.example.com")).toBe("https://m.example.com");
  });

  it("strips path, query, and fragment", () => {
    expect(originOnly("https://m.example.com/path?q=1#frag")).toBe("https://m.example.com");
  });

  it("strips embedded credentials", () => {
    expect(originOnly("https://user:pass@m.example.com")).toBe("https://m.example.com");
  });

  it("preserves non-default port", () => {
    expect(originOnly("https://m.example.com:8443/x")).toBe("https://m.example.com:8443");
  });

  it("throws on a value that cannot be parsed as a URL", () => {
    expect(() => originOnly("not a url")).toThrow();
  });
});

describe("normalizeUrl edge cases", () => {
  it.each([
    ["https://m.example.com", "https://m.example.com"],
    ["https://m.example.com/", "https://m.example.com"],
    ["https://m.example.com//", "https://m.example.com"],
    ["https://m.example.com////////", "https://m.example.com"],
    ["http://m.example.com/", "http://m.example.com"],
    ["HTTPS://M.EXAMPLE.COM/", "HTTPS://M.EXAMPLE.COM"],
    ["  https://m.example.com  ", "https://m.example.com"],
    ["\thttps://m.example.com\n", "https://m.example.com"],
    ["https://m.example.com/path/", "https://m.example.com/path"],
    ["https://m.example.com/path?q=1", "https://m.example.com/path?q=1"],
    ["https://m.example.com:8443/", "https://m.example.com:8443"],
  ])("normalize(%j) === %j", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("is idempotent across the matrix above", () => {
    const cases = [
      "https://m.example.com",
      "https://m.example.com/",
      "https://m.example.com////",
      "  https://m.example.com  ",
      "https://m.example.com:8443/path/",
    ];
    for (const input of cases) {
      const once = normalizeUrl(input);
      expect(normalizeUrl(once)).toBe(once);
    }
  });

  it.each([
    "",
    "m.example.com",
    "ftp://m.example.com",
    "://m.example.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ws://m.example.com",
  ])("rejects %j with the http-required message", (input) => {
    expect(() => normalizeUrl(input)).toThrow("URL must start with http:// or https://");
  });
});

describe("originOnly edge cases", () => {
  it.each([
    ["https://m.example.com", "https://m.example.com"],
    ["https://m.example.com/", "https://m.example.com"],
    ["https://m.example.com/path", "https://m.example.com"],
    ["https://m.example.com/a/b/c", "https://m.example.com"],
    ["https://m.example.com/?q=1", "https://m.example.com"],
    ["https://m.example.com/#frag", "https://m.example.com"],
    ["https://m.example.com/path?q=1#frag", "https://m.example.com"],
    ["https://user:pass@m.example.com", "https://m.example.com"],
    ["https://user:pass@m.example.com:8443/x?q=1", "https://m.example.com:8443"],
    ["https://m.example.com:8443/x", "https://m.example.com:8443"],
    ["http://m.example.com:80/x", "http://m.example.com"],
    ["https://m.example.com:443/x", "https://m.example.com"],
    ["http://[::1]:8080/path", "http://[::1]:8080"],
    ["http://192.168.1.1/x?y=1", "http://192.168.1.1"],
  ])("originOnly(%j) === %j", (input, expected) => {
    expect(originOnly(input)).toBe(expected);
  });
});
