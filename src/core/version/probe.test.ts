import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { VersionTagParseError } from "../../domain/session-properties";
import type { Client, RequestOptions } from "../http/client";

import { createServerInfoCache, EMPTY_SERVER_INFO, probeServer } from "./probe";

interface ProbeCall {
  path: string;
  options: RequestOptions | undefined;
}

interface FakeClient extends Client {
  readonly calls: ReadonlyArray<ProbeCall>;
}

function makeFakeClient(response: unknown, options: { throwError?: Error } = {}): FakeClient {
  const calls: ProbeCall[] = [];
  return {
    calls,
    async requestParsed<T>(schema: ZodType<T>, path: string, opts?: RequestOptions): Promise<T> {
      calls.push({ path, options: opts });
      if (options.throwError !== undefined) {
        throw options.throwError;
      }
      return schema.parse(response);
    },
    async requestRaw(): Promise<Response> {
      throw new Error("requestRaw not implemented for probe fake");
    },
    async requestStream(): Promise<ReadableStream<Uint8Array>> {
      throw new Error("requestStream not implemented for probe fake");
    },
  };
}

const EXPECTED_PROBE_CALL: ProbeCall = {
  path: "/api/session/properties",
  options: { timeoutMs: 10_000, retries: 0 },
};

describe("probeServer", () => {
  it("returns parsed ServerInfo on a successful EE-enterprise response", async () => {
    const client = makeFakeClient({
      version: { tag: "v1.58.7", date: "2025-12-15", hash: "abc1234" },
      "token-features": { advanced_permissions: true, audit_app: true, embedding: true },
    });
    const info = await probeServer(client);
    expect(info).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "enterprise",
      tokenFeatures: { advanced_permissions: true, audit_app: true, embedding: true },
    });
  });

  it("queries /api/session/properties with retries disabled and a short timeout", async () => {
    const client = makeFakeClient({ version: { tag: "v0.58.7" } });
    await probeServer(client);
    expect(client.calls).toEqual([EXPECTED_PROBE_CALL]);
  });

  it("classifies an EE-build response with all token-features false as oss", async () => {
    const client = makeFakeClient({
      version: { tag: "v1.58.7" },
      "token-features": { advanced_permissions: false, embedding: false },
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "oss",
      tokenFeatures: { advanced_permissions: false, embedding: false },
    });
  });

  it("propagates an unrecognized version tag as VersionTagParseError", async () => {
    const client = makeFakeClient({ version: { tag: "vLOCAL_DEV" } });
    let caught: unknown;
    try {
      await probeServer(client);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VersionTagParseError);
    if (caught instanceof VersionTagParseError) {
      expect(caught.message).toBe(
        `Unrecognized Metabase version tag: "vLOCAL_DEV" (expected v0.X.Y or v1.X.Y)`,
      );
    }
  });
});

describe("createServerInfoCache", () => {
  it("probes once even when called many times concurrently", async () => {
    const client = makeFakeClient({
      version: { tag: "v0.58.7" },
      "token-features": {},
    });
    const getInfo = createServerInfoCache(async () => client);
    const [a, b, c] = await Promise.all([getInfo(), getInfo(), getInfo()]);
    expect(client.calls).toEqual([EXPECTED_PROBE_CALL]);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("returns EMPTY_SERVER_INFO when the probe rejects", async () => {
    const client = makeFakeClient(null, { throwError: new Error("boom") });
    const getInfo = createServerInfoCache(async () => client);
    expect(await getInfo()).toBe(EMPTY_SERVER_INFO);
  });

  it("caches the EMPTY fallback so transient failures do not re-probe per call", async () => {
    const client = makeFakeClient(null, { throwError: new Error("boom") });
    const getInfo = createServerInfoCache(async () => client);
    await getInfo();
    await getInfo();
    expect(client.calls).toEqual([EXPECTED_PROBE_CALL]);
  });
});
