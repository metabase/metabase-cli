import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { createClient } from "../client";
import { AbortError, TimeoutError } from "../errors";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.66.0", major: 66, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: true },
});

const CLEAN_REPORT = {
  status: "passed",
  summary: { errors: 0, warnings: 0, entities: 0 },
  entities: {},
  rules: {},
  results: [],
};

// The attempts run against the real clock, so every timeout is cut by this much: a 290s attempt
// lasts 29ms.
const TIME_SCALE = 10_000;
const ATTEMPT_MS = 290_000;
const DEADLINE_MS = 30 * 60_000;

const HANG = "hang";
// A connection the peer closes this long into the request, unless its signal aborts first.
interface Drop {
  closedAfterMs: number;
}
type Answer = Response | typeof HANG | Drop;

interface ScriptedFetch {
  fetch: typeof fetch;
  calls: () => number;
  // The time the requests sent so far spent in flight, added up, at the unscaled clock.
  inFlightMs: () => number;
}

// Answers each request with the next of `answers`; a `HANG` stays pending until its signal aborts,
// then rejects with an AbortError. A request sent with a signal already aborted rejects at once, as `fetch` does.
function scriptedFetch(answers: readonly Answer[]): ScriptedFetch {
  const queue = [...answers];
  let calls = 0;
  let inFlightMs = 0;
  const answer = (next: Answer, signal: AbortSignal | undefined): Promise<Response> => {
    if (next instanceof Response) {
      return Promise.resolve(next);
    }
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      if (next !== HANG) {
        setTimeout(() => {
          reject(connectionClosed());
        }, next.closedAfterMs / TIME_SCALE);
      }
    });
  };
  const fetchImpl: typeof fetch = (_input, init) => {
    calls += 1;
    if (init?.signal?.aborted) {
      return Promise.reject(init.signal.reason);
    }
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("scriptedFetch: no more answers queued"));
    }
    const sentAt = performance.now();
    return answer(next, init?.signal ?? undefined).finally(() => {
      inFlightMs += (performance.now() - sentAt) * TIME_SCALE;
    });
  };
  return { fetch: fetchImpl, calls: () => calls, inFlightMs: () => inFlightMs };
}

// What Node's `fetch` rejects with when the peer closes the connection.
function connectionClosed(): TypeError {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
  });
}

function clientOver(answers: readonly Answer[]) {
  const scripted = scriptedFetch(answers);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: scripted.fetch,
    server: SERVER,
  });
  return { mb, calls: scripted.calls, inFlightMs: scripted.inFlightMs };
}

function scaleTimeouts() {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => realTimeout(Math.ceil(ms / TIME_SCALE)));
}

// The clock runs at the scale of the timeouts, so a deadline kept by the clock is cut as much.
function scaleClock() {
  const realNow = Date.now.bind(Date);
  const start = realNow();
  vi.spyOn(Date, "now").mockImplementation(() => start + (realNow() - start) * TIME_SCALE);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lint.report", () => {
  it("resends a report whose attempt timed out, answering with the first that completes", async () => {
    scaleTimeouts();
    const { mb, calls } = clientOver([HANG, HANG, jsonResponse(CLEAN_REPORT)]);

    const report = await mb.lint.report();

    expect(report).toEqual(CLEAN_REPORT);
    expect(calls()).toBe(3);
  });

  it("gives each attempt less than Node's headers limit, and gives up at the deadline", async () => {
    const timeouts = scaleTimeouts();
    scaleClock();
    const { mb } = clientOver(Array.from({ length: 8 }, () => HANG));

    const error = await thrownBy(() => mb.lint.report());

    expect(error).toBeInstanceOf(TimeoutError);
    assert(error instanceof TimeoutError, "expected TimeoutError");
    expect(error.message).toBe(`Request timed out after ${DEADLINE_MS}ms`);
    expect(error.developerDetail).toEqual({
      kind: "http",
      method: "POST",
      url: "https://mb.example.com/api/ee/lint",
      timeoutMs: DEADLINE_MS,
    });
    const attempts = timeouts.mock.calls.map(([ms]) => ms);
    expect(attempts[0]).toBe(ATTEMPT_MS);
    expect(attempts.filter((ms) => ms > ATTEMPT_MS)).toEqual([]);
  });

  it("keeps every attempt, a resend after a closed connection too, within the deadline", async () => {
    scaleTimeouts();
    scaleClock();
    const { mb, inFlightMs } = clientOver([
      { closedAfterMs: 280_000 },
      ...Array.from({ length: 7 }, (): Answer => HANG),
    ]);

    const error = await thrownBy(() => mb.lint.report());

    expect(error).toBeInstanceOf(TimeoutError);
    expect(inFlightMs()).toBeLessThanOrEqual(DEADLINE_MS);
  });

  it("gives a caller's timeoutMs shorter than one attempt to a single attempt", async () => {
    const timeouts = scaleTimeouts();
    scaleClock();
    const { mb, calls } = clientOver(Array.from({ length: 7 }, () => HANG));

    const error = await thrownBy(() => mb.lint.report({ timeoutMs: 100_000 }));

    expect(error).toBeInstanceOf(TimeoutError);
    assert(error instanceof TimeoutError, "expected TimeoutError");
    expect(error.message).toBe("Request timed out after 100000ms");
    expect(calls()).toBe(1);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([100_000]);
  });

  it("stops without resending when the caller's signal aborts during an attempt", async () => {
    const controller = new AbortController();
    const { mb, calls } = clientOver([HANG]);

    const reporting = thrownBy(() => mb.lint.report({ signal: controller.signal }));
    await vi.waitUntil(() => calls() === 1);
    controller.abort(new AbortError("interrupted"));
    const error = await reporting;

    expect(error).toBeInstanceOf(AbortError);
    assert(error instanceof AbortError, "expected AbortError");
    expect(error.message).toBe("interrupted");
    expect(calls()).toBe(1);
  });

  it("sends one POST to /api/ee/lint with no body", async () => {
    const capture = captureFetch([jsonResponse(CLEAN_REPORT)]);
    const mb = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
      server: SERVER,
    });

    const report = await mb.lint.report();

    expect(report).toEqual(CLEAN_REPORT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/api/ee/lint",
        method: "POST",
        headers: {
          accept: "application/json",
          "user-agent": TEST_USER_AGENT,
          "x-api-key": "mb_wire_test_key",
        },
        body: null,
      },
    ]);
  });

  it("does not resend a report the server answered with an error status", async () => {
    const { mb, calls } = clientOver([jsonResponse({ message: "Lint failed" }, 500)]);

    const error = await thrownBy(() => mb.lint.report());

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(500);
    expect(error.message).toContain("Lint failed");
    expect(calls()).toBe(1);
  });
});
