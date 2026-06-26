import * as fc from "fast-check";
import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "./errors";
import { assertEndpointOrigin, displayUrl, isLoopbackHost, normalizeUrl } from "./url";

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

  it("rejects a scheme-less URL with a ConfigError (exit-2 input error, not an internal crash)", () => {
    const error = (() => {
      try {
        normalizeUrl("m.example.com");
      } catch (caught: unknown) {
        return caught;
      }
      throw new Error("expected normalizeUrl to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("URL must start with http:// or https://");
    expect(error.exitCode).toBe(2);
  });
});

describe("displayUrl", () => {
  it("returns a plain URL unchanged", () => {
    expect(displayUrl("https://m.example.com")).toBe("https://m.example.com");
  });

  it("keeps a subpath (instances hosted under a path stay distinguishable)", () => {
    expect(displayUrl("https://my.org.com/metabase")).toBe("https://my.org.com/metabase");
  });

  it("strips query and fragment but keeps the path", () => {
    expect(displayUrl("https://m.example.com/path?q=1#frag")).toBe("https://m.example.com/path");
  });

  it("strips embedded credentials", () => {
    expect(displayUrl("https://user:pass@m.example.com")).toBe("https://m.example.com");
  });

  it("preserves non-default port", () => {
    expect(displayUrl("https://m.example.com:8443/x")).toBe("https://m.example.com:8443/x");
  });

  it("throws on a value that cannot be parsed as a URL", () => {
    expect(() => displayUrl("not a url")).toThrow();
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

describe("displayUrl edge cases", () => {
  it.each([
    ["https://m.example.com", "https://m.example.com"],
    ["https://m.example.com/", "https://m.example.com"],
    ["https://m.example.com/path", "https://m.example.com/path"],
    ["https://m.example.com/a/b/c", "https://m.example.com/a/b/c"],
    ["https://my.org.com/metabase/", "https://my.org.com/metabase"],
    ["https://m.example.com/?q=1", "https://m.example.com"],
    ["https://m.example.com/#frag", "https://m.example.com"],
    ["https://m.example.com/path?q=1#frag", "https://m.example.com/path"],
    ["https://user:pass@m.example.com", "https://m.example.com"],
    ["https://user:pass@m.example.com:8443/x?q=1", "https://m.example.com:8443/x"],
    ["https://m.example.com:8443/x", "https://m.example.com:8443/x"],
    ["http://m.example.com:80/x", "http://m.example.com/x"],
    ["https://m.example.com:443/x", "https://m.example.com/x"],
    ["http://[::1]:8080/path", "http://[::1]:8080/path"],
    ["http://192.168.1.1/x?y=1", "http://192.168.1.1/x"],
  ])("displayUrl(%j) === %j", (input, expected) => {
    expect(displayUrl(input)).toBe(expected);
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"])("treats %j as loopback", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });

  it.each(["mb.example.com", "127.0.0.2", "169.254.0.1", "example.localhost.evil.com"])(
    "treats %j as non-loopback",
    (h) => {
      expect(isLoopbackHost(h)).toBe(false);
    },
  );
});

describe("assertEndpointOrigin", () => {
  const base = "https://mb.example.com";

  it("accepts a same-origin https endpoint", () => {
    expect(() =>
      assertEndpointOrigin("https://mb.example.com/oauth/token", base, "token endpoint"),
    ).not.toThrow();
  });

  it("ignores path differences (compares origin, not the full URL)", () => {
    expect(() =>
      assertEndpointOrigin("https://mb.example.com/oauth/token", `${base}/subpath`, "endpoint"),
    ).not.toThrow();
  });

  it("rejects a cross-origin endpoint", () => {
    const error = (() => {
      try {
        assertEndpointOrigin("https://attacker.example.com/oauth/token", base, "token endpoint");
      } catch (caught: unknown) {
        return caught;
      }
      throw new Error("expected assertEndpointOrigin to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("token endpoint");
    expect(error.message).toContain("does not match the Metabase URL");
  });

  it("rejects a cross-port endpoint (port is part of the origin)", () => {
    expect(() =>
      assertEndpointOrigin("https://mb.example.com:8443/oauth/token", base, "endpoint"),
    ).toThrow(ConfigError);
  });

  it("rejects a non-loopback http endpoint", () => {
    expect(() =>
      assertEndpointOrigin(
        "http://mb.example.com/oauth/token",
        "http://mb.example.com",
        "endpoint",
      ),
    ).toThrow("must use https");
  });

  it("allows an http endpoint on a loopback host", () => {
    expect(() =>
      assertEndpointOrigin(
        "http://localhost:3000/oauth/token",
        "http://localhost:3000",
        "endpoint",
      ),
    ).not.toThrow();
  });

  it("rejects an unparseable endpoint", () => {
    expect(() => assertEndpointOrigin("not a url", base, "endpoint")).toThrow(ConfigError);
  });
});

describe("normalizeUrl property tests", () => {
  const httpScheme = fc.constantFrom("http://", "https://", "HTTP://", "HTTPS://", "HtTp://");
  const hostname = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,30}\.[a-z]{2,6}$/)
    .filter((value) => !value.startsWith("xn--"));
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

describe("assertEndpointOrigin property tests", () => {
  const hostname = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,30}\.[a-z]{2,6}$/)
    .filter((value) => !value.startsWith("xn--"));
  const optionalPort = fc.option(
    fc.integer({ min: 1, max: 65535 }).map((port) => `:${port}`),
    { nil: "" },
  );
  const origin = fc.tuple(hostname, optionalPort).map(([host, port]) => `https://${host}${port}`);
  const path = fc
    .array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 0, maxLength: 4 })
    .map((parts) => (parts.length === 0 ? "" : `/${parts.join("/")}`));

  it("property: any path on the base origin is accepted", () => {
    fc.assert(
      fc.property(origin, path, (base, endpointPath) => {
        expect(() =>
          assertEndpointOrigin(`${base}${endpointPath}`, base, "endpoint"),
        ).not.toThrow();
      }),
    );
  });

  it("property: any endpoint on a different origin is rejected with ConfigError", () => {
    fc.assert(
      fc.property(origin, origin, path, (endpointOrigin, base, endpointPath) => {
        fc.pre(new URL(endpointOrigin).origin !== new URL(base).origin);
        expect(() =>
          assertEndpointOrigin(`${endpointOrigin}${endpointPath}`, base, "endpoint"),
        ).toThrow(ConfigError);
      }),
    );
  });
});

describe("displayUrl property tests", () => {
  const safeHost = fc
    .stringMatching(/^[a-z][a-z0-9-]{0,30}\.[a-z]{2,6}$/)
    .filter((host) => !host.startsWith("xn--"));

  it("property: result never contains userinfo (no '@' between scheme and host)", () => {
    const userinfo = fc.stringMatching(/^[a-z0-9]{1,8}:[a-z0-9]{1,8}@$/);
    const optionalUser = fc.option(userinfo, { nil: "" });
    fc.assert(
      fc.property(safeHost, optionalUser, (host, user) => {
        const input = `https://${user}${host}/some/path?q=1#frag`;
        const result = displayUrl(input);
        expect(result.includes("@")).toBe(false);
      }),
    );
  });

  it("property: result keeps the path but drops query and fragment", () => {
    fc.assert(
      fc.property(
        safeHost,
        fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { maxLength: 5 }),
        (host, parts) => {
          const path = parts.length > 0 ? `/${parts.join("/")}` : "";
          const input = `http://${host}${path}?key=value#section`;
          const result = displayUrl(input);
          expect(result).toBe(`http://${host}${path}`);
        },
      ),
    );
  });
});
