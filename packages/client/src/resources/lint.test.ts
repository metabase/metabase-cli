import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { createClient } from "../client";
import { TimeoutError } from "../errors";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
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
type Answer = Response | typeof HANG;

interface ScriptedFetch {
  fetch: typeof fetch;
  calls: () => number;
}

// Answers each request with the next of `answers`; a hung one never answers, until its signal
// aborts.
function scriptedFetch(answers: readonly Answer[]): ScriptedFetch {
  const queue = [...answers];
  let calls = 0;
  const fetchImpl: typeof fetch = (_input, init) => {
    calls += 1;
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("scriptedFetch: no more answers queued"));
    }
    if (next !== HANG) {
      return Promise.resolve(next);
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  };
  return { fetch: fetchImpl, calls: () => calls };
}

function clientOver(answers: readonly Answer[]) {
  const scripted = scriptedFetch(answers);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: scripted.fetch,
    server: SERVER,
  });
  return { mb, calls: scripted.calls };
}

function scaleTimeouts() {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  return vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => realTimeout(Math.ceil(ms / TIME_SCALE)));
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
    const { mb, calls } = clientOver(Array.from({ length: 7 }, () => HANG));

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
    expect(calls()).toBe(7);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([
      ...Array.from({ length: 6 }, () => ATTEMPT_MS),
      DEADLINE_MS - 6 * ATTEMPT_MS,
    ]);
  });

  it("does not resend a report the server refused", async () => {
    const { mb, calls } = clientOver([jsonResponse({ message: "Lint failed" }, 500)]);

    const error = await thrownBy(() => mb.lint.report());

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(500);
    expect(calls()).toBe(1);
  });
});
