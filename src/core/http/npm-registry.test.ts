import { describe, expect, it } from "vitest";

import { NetworkError, TimeoutError, ValidationError } from "../errors";

import { HttpError } from "./errors";
import { fetchNpmDistTags } from "./npm-registry";

interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

function makeFetch(response: Response | Promise<Response> | Error): {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      headers: headersToRecord(init?.headers),
    });
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
  return { fetchImpl, calls };
}

function headersToRecord(init: RequestInit["headers"]): Record<string, string> {
  const record: Record<string, string> = {};
  if (!init) {
    return record;
  }
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  if (Array.isArray(init)) {
    for (const entry of init) {
      const [key, value] = entry;
      if (typeof key === "string" && typeof value === "string") {
        record[key.toLowerCase()] = value;
      }
    }
    return record;
  }
  for (const [key, value] of Object.entries(init)) {
    if (typeof value === "string") {
      record[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      record[key.toLowerCase()] = value.join(", ");
    }
  }
  return record;
}

const pendingAbortFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

describe("fetchNpmDistTags", () => {
  it("hits /-/package/<scope%2Fname>/dist-tags on the default registry", async () => {
    const { fetchImpl, calls } = makeFetch(
      new Response(JSON.stringify({ latest: "1.2.3", beta: "1.3.0-beta.1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchNpmDistTags("@metabase/cli", { fetchImpl });
    expect(result).toEqual({ latest: "1.2.3", beta: "1.3.0-beta.1" });
    expect(calls).toEqual([
      {
        url: "https://registry.npmjs.org/-/package/@metabase%2Fcli/dist-tags",
        headers: {
          accept: "application/json",
          "user-agent": expect.stringMatching(/^metabase-cli\//),
        },
      },
    ]);
  });

  it("honors a custom registry URL and trims trailing slashes", async () => {
    const { fetchImpl, calls } = makeFetch(
      new Response(JSON.stringify({ latest: "0.1.2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await fetchNpmDistTags("@metabase/cli", {
      fetchImpl,
      registry: "http://localhost:1234///",
    });
    expect(calls[0]?.url).toBe("http://localhost:1234/-/package/@metabase%2Fcli/dist-tags");
  });

  it("URL-encodes the scope separator only (keeps @ literal)", async () => {
    const { fetchImpl, calls } = makeFetch(
      new Response(JSON.stringify({ latest: "0.0.1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await fetchNpmDistTags("unscoped-pkg", { fetchImpl });
    expect(calls[0]?.url).toBe("https://registry.npmjs.org/-/package/unscoped-pkg/dist-tags");
  });

  it("throws NetworkError when fetch rejects with a connection failure", async () => {
    const { fetchImpl } = makeFetch(new TypeError("connect ECONNREFUSED 127.0.0.1:1234"));
    let captured: unknown;
    try {
      await fetchNpmDistTags("@metabase/cli", {
        fetchImpl,
        registry: "http://localhost:1234",
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(NetworkError);
    if (captured instanceof NetworkError) {
      expect(captured.message).toBe(
        "could not reach npm registry: connect ECONNREFUSED 127.0.0.1:1234",
      );
    }
  });

  it("throws TimeoutError when the timeout signal aborts", async () => {
    let captured: unknown;
    try {
      await fetchNpmDistTags("@metabase/cli", { fetchImpl: pendingAbortFetch, timeoutMs: 5 });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(TimeoutError);
    if (captured instanceof TimeoutError) {
      expect(captured.message).toBe("npm registry request timed out after 5ms");
    }
  });

  it("throws HttpError for a 404 from the registry", async () => {
    const { fetchImpl } = makeFetch(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      }),
    );
    let captured: unknown;
    try {
      await fetchNpmDistTags("@no/such-thing", { fetchImpl });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(HttpError);
    if (captured instanceof HttpError) {
      expect(captured.status).toBe(404);
    }
  });

  it("throws ValidationError when the registry omits `latest`", async () => {
    const { fetchImpl } = makeFetch(
      new Response(JSON.stringify({ beta: "1.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(fetchNpmDistTags("@metabase/cli", { fetchImpl })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
