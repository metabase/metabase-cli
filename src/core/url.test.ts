import * as fc from "fast-check";
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

describe("normalizeUrl property tests", () => {
  const httpScheme = fc.constantFrom("http://", "https://", "HTTP://", "HTTPS://", "HtTp://");
  const hostname = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,30}\.[a-z]{2,6}$/)
    .filter((value) => value.length > 0);
  const optionalPort = fc.option(
    fc.integer({ min: 1, max: 65535 }).map((port) => `:${port}`),
    { nil: "" },
  );
  const optionalPath = fc.option(
    fc
      .array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 1, maxLength: 4 })
      .map((parts) => `/${parts.join("/")}`),
    { nil: "" },
  );
  const trailingSlashes = fc.stringMatching(/^\/{0,5}$/);
  const surroundingWhitespace = fc.stringMatching(/^[ \t\n]{0,4}$/);

  it("property: result never ends in a trailing slash and starts with the scheme", () => {
    fc.assert(
      fc.property(
        httpScheme,
        hostname,
        optionalPort,
        optionalPath,
        trailingSlashes,
        surroundingWhitespace,
        surroundingWhitespace,
        (scheme, host, port, path, slashes, leading, trailing) => {
          const input = `${leading}${scheme}${host}${port}${path}${slashes}${trailing}`;
          const result = normalizeUrl(input);
          expect(result.endsWith("/")).toBe(false);
          expect(result.toLowerCase().startsWith(scheme.toLowerCase())).toBe(true);
          expect(result.trim()).toBe(result);
        },
      ),
    );
  });

  it("property: idempotent — normalizeUrl(normalizeUrl(x)) === normalizeUrl(x)", () => {
    fc.assert(
      fc.property(
        httpScheme,
        hostname,
        optionalPort,
        optionalPath,
        trailingSlashes,
        surroundingWhitespace,
        (scheme, host, port, path, slashes, leading) => {
          const input = `${leading}${scheme}${host}${port}${path}${slashes}`;
          const once = normalizeUrl(input);
          expect(normalizeUrl(once)).toBe(once);
        },
      ),
    );
  });

  it("property: rejects any non-http(s) scheme with the documented message", () => {
    const otherScheme = fc.constantFrom(
      "ftp://",
      "ws://",
      "wss://",
      "file://",
      "javascript:",
      "data:",
      "gopher://",
      "ssh://",
    );
    fc.assert(
      fc.property(otherScheme, hostname, (scheme, host) => {
        expect(() => normalizeUrl(`${scheme}${host}`)).toThrow(
          "URL must start with http:// or https://",
        );
      }),
    );
  });
});

describe("originOnly property tests", () => {
  const safeHost = fc.stringMatching(/^[a-z][a-z0-9-]{0,30}\.[a-z]{2,6}$/);

  it("property: result never contains userinfo (no '@' between scheme and host)", () => {
    const userinfo = fc.stringMatching(/^[a-z0-9]{1,8}:[a-z0-9]{1,8}@$/);
    const optionalUser = fc.option(userinfo, { nil: "" });
    fc.assert(
      fc.property(safeHost, optionalUser, (host, user) => {
        const input = `https://${user}${host}/some/path?q=1#frag`;
        const result = originOnly(input);
        expect(result.includes("@")).toBe(false);
      }),
    );
  });

  it("property: result has no path, query, or fragment", () => {
    fc.assert(
      fc.property(
        safeHost,
        fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { maxLength: 5 }),
        (host, parts) => {
          const path = parts.length > 0 ? `/${parts.join("/")}` : "";
          const input = `http://${host}${path}?key=value#section`;
          const result = originOnly(input);
          expect(result.includes("?")).toBe(false);
          expect(result.includes("#")).toBe(false);
          const afterScheme = result.replace(/^https?:\/\//, "");
          expect(afterScheme.includes("/")).toBe(false);
        },
      ),
    );
  });
});
