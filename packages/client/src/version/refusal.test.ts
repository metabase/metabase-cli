import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { AbortError } from "../errors";
import { HttpError, PAYMENT_REQUIRED_STATUS } from "../http/errors";
import {
  type ClientCredentials,
  createTransport,
  type RequestOptions,
  type Transport,
} from "../http/transport";
import { premiumRefusalResponse, probeResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import { CapabilityError } from "./capability-error";
import { PROBE_PATH } from "./probe";
import { createServerProfile } from "./profile";
import { explainer, explainRefusal } from "./refusal";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key_abcdef0123" },
};

const PingResponse = z.object({ id: z.number().int(), email: z.string() });

const HANGING_FETCH: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

// A fetch answering every request with a fresh `response()`.
function answering(response: () => Response): typeof fetch {
  return async () => response();
}

// A v58 server licensed for nothing, so it lacks every feature the cases below name.
const UNLICENSED_58 = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: {},
});

function notOnThisPath(): never {
  throw new Error("the explainer reaches the transport only to explain a failure");
}

// A transport whose only use on the explainer's path is the profile an explanation reads, which it
// answers with `UNLICENSED_58`, counting the reads.
function probingTransport(): { transport: Transport; reads: () => number } {
  let reads = 0;
  const transport: Transport = {
    requestParsed: notOnThisPath,
    requestRaw: notOnThisPath,
    requestStream: notOnThisPath,
    server: notOnThisPath,
    async verifiedServer() {
      reads += 1;
      return UNLICENSED_58;
    },
    probe: notOnThisPath,
    requireFeatures: notOnThisPath,
    preflightServer: notOnThisPath,
    refuseBeforeSending: notOnThisPath,
    probesSettled: notOnThisPath,
  };
  return { transport, reads: () => reads };
}

const REFUSED = new HttpError({
  status: PAYMENT_REQUIRED_STATUS,
  statusText: "Payment Required",
  method: "GET",
  url: "https://m.example.com/api/ee/feature",
  responseHeaders: {},
  rawBody: null,
});

async function refuse(_kind: string, _id: number, _options: RequestOptions = {}): Promise<never> {
  throw REFUSED;
}

async function failureOf(call: Promise<unknown>): Promise<CapabilityError> {
  const error = await call.catch((caught: unknown) => caught);
  assert(error instanceof CapabilityError, "expected CapabilityError");
  return error;
}

describe("explainer", () => {
  it("answers what the wrapped method answers and explains nothing", async () => {
    const { transport, reads } = probingTransport();
    const { explain } = explainer(transport, "erd");

    const get = explain("get", async (id: number) => ({ id }));

    expect(await get(4)).toEqual({ id: 4 });
    expect(reads()).toBe(0);
  });

  it("explains a failure by the method's own requirements, carrying the server's refusal", async () => {
    const { transport } = probingTransport();
    const { explain } = explainer(transport, "erd");

    const get = explain("get", refuse);

    const error = await failureOf(get("job", 1));
    expect(error.developerDetail.feature).toBe("erd");
    expect(error.cause).toBe(REFUSED);
  });

  it("puts the features the arguments bring ahead of the method's own", async () => {
    const { transport } = probingTransport();
    const { explain } = explainer(transport, "dependency");

    const graph = explain("graph", refuse, (kind) =>
      kind === "measure" ? [{ feature: "measureDependencyGraph", fields: ["type"] }] : [],
    );

    const measure = await failureOf(graph("measure", 1));
    const card = await failureOf(graph("card", 1));
    expect([measure.developerDetail.feature, card.developerDetail.feature]).toEqual([
      "measureDependencyGraph",
      "dependencyGraph",
    ]);
  });
});

describe("explainRefusal", () => {
  const LICENSED_63 = createServerProfile({
    edition: "ee",
    version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures: { remote_sync: true },
  });
  const UNLICENSED_63 = createServerProfile({
    edition: "ee",
    version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures: { remote_sync: false },
  });

  // A transport whose first request fails as `failure` and whose later ones are `rest`, handed the
  // licensed profile a cache would hold.
  function transportOver(failure: Response, rest: typeof fetch) {
    let first = true;
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (first) {
        first = false;
        return failure;
      }
      return rest(input, init);
    };
    const controller = new AbortController();
    const transport = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl,
      server: LICENSED_63,
      signal: controller.signal,
    });
    return { transport, urls, stop: () => controller.abort(new Error("test over")) };
  }

  async function failedRequest(transport: Transport): Promise<unknown> {
    return transport
      .requestParsed(PingResponse, "/api/ee/remote-sync/branches", { retries: 0 })
      .catch((caught: unknown) => caught);
  }

  it("turns a premium refusal into the feature a fresh probe finds missing, whatever the cache said", async () => {
    const { transport, urls } = transportOver(
      premiumRefusalResponse("Remote Sync"),
      answering(() => probeResponse(UNLICENSED_63)),
    );
    const refusal = await failedRequest(transport);

    const explained = await explainRefusal(
      transport,
      { parameters: [], method: ["remoteSync"] },
      refusal,
    );

    assert(explained instanceof CapabilityError, "expected CapabilityError");
    expect(explained.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
      feature: "remoteSync",
      since: 58,
      tokenFeature: "remote_sync",
      serverVersion: "v1.63.0",
    });
    expect(urls).toEqual([
      "https://m.example.com/api/ee/remote-sync/branches",
      `https://m.example.com${PROBE_PATH}`,
    ]);
  });

  it("lets the server's error stand when a fresh probe finds every feature", async () => {
    const { transport } = transportOver(
      premiumRefusalResponse("Remote Sync"),
      answering(() => probeResponse(LICENSED_63)),
    );
    const refusal = await failedRequest(transport);

    expect(
      await explainRefusal(transport, { parameters: [], method: ["remoteSync"] }, refusal),
    ).toBe(refusal);
  });

  it("never blames a missing row on a feature, and asks the server nothing", async () => {
    const { transport, urls } = transportOver(
      new Response("Not found.", { status: 404, headers: { "content-type": "text/plain" } }),
      answering(() => probeResponse(UNLICENSED_63)),
    );
    const missing = await failedRequest(transport);

    expect(
      await explainRefusal(transport, { parameters: [], method: ["remoteSync"] }, missing),
    ).toBe(missing);
    expect(urls).toEqual(["https://m.example.com/api/ee/remote-sync/branches"]);
  });

  it("leaves a failure that is no refusal unexplained, and asks the server nothing", async () => {
    const { transport, urls } = transportOver(
      new Response("boom", { status: 500 }),
      answering(() => probeResponse(UNLICENSED_63)),
    );
    const failure = await failedRequest(transport);

    expect(
      await explainRefusal(transport, { parameters: [], method: ["remoteSync"] }, failure),
    ).toBe(failure);
    expect(urls).toEqual(["https://m.example.com/api/ee/remote-sync/branches"]);
  });

  it("lets the refusal stand when the explaining probe fails", async () => {
    const { transport } = transportOver(
      premiumRefusalResponse("Remote Sync"),
      answering(() => new Response("boom", { status: 500 })),
    );
    const refusal = await failedRequest(transport);

    expect(
      await explainRefusal(transport, { parameters: [], method: ["remoteSync"] }, refusal),
    ).toBe(refusal);
  });

  it("surfaces the client-wide interrupt during the explaining probe rather than the refusal", async () => {
    const { transport, stop } = transportOver(premiumRefusalResponse("Remote Sync"), HANGING_FETCH);
    const refusal = await failedRequest(transport);

    const pending = explainRefusal(
      transport,
      { parameters: [], method: ["remoteSync"] },
      refusal,
    ).catch((caught: unknown) => caught);
    stop();

    const error = await pending;
    assert(error instanceof AbortError, "expected AbortError");
    expect(error.message).toBe("test over");
  });

  it("explains nothing for a call that needs no feature", async () => {
    const { transport, urls } = transportOver(
      premiumRefusalResponse("Remote Sync"),
      answering(() => probeResponse(UNLICENSED_63)),
    );
    const refusal = await failedRequest(transport);

    expect(await explainRefusal(transport, { parameters: [], method: [] }, refusal)).toBe(refusal);
    expect(urls).toEqual(["https://m.example.com/api/ee/remote-sync/branches"]);
  });
});
