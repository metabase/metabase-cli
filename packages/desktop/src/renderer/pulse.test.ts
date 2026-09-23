import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../contracts/events";

import { RESTING, pulseAfter, toneOf } from "./pulse";

const SESSION_ID = "ses_1";
const AT = "2026-09-22T12:00:00.000Z";

let seq = 0;

function scope(): Pick<SessionEvent, "id" | "sessionId" | "seq" | "at"> {
  seq += 1;
  return { id: `evt_${String(seq)}`, sessionId: SESSION_ID, seq, at: AT };
}

const STARTED: SessionEvent = {
  ...scope(),
  type: "turn.started",
  turnId: "t1",
  userMessageId: "m1",
};
const ASKED: SessionEvent = {
  ...scope(),
  type: "request.opened",
  turnId: "t1",
  requestId: "req_1",
  kind: "permission",
  callId: null,
  prompt: "Write hello.txt?",
  options: [{ id: "allow", label: "Allow", hint: null }],
  acceptsText: false,
};
const ANSWERED: SessionEvent = {
  ...scope(),
  type: "request.resolved",
  turnId: "t1",
  requestId: "req_1",
  resolution: { kind: "answered", optionId: "allow", text: null },
};
const ENDED: SessionEvent = {
  ...scope(),
  type: "turn.completed",
  turnId: "t1",
  outcome: { kind: "completed" },
  usage: null,
  durationMs: 1000,
};
const BROKE: SessionEvent = {
  ...scope(),
  type: "session.failed",
  reason: "the agent exited",
  providerError: null,
};

describe("what the sidebar's dot says", () => {
  it("rests until something happens", () => {
    expect(toneOf(RESTING)).toBe("idle");
  });

  it("works once a turn opens", () => {
    expect(toneOf(pulseAfter(RESTING, [STARTED]))).toBe("running");
  });

  it("waits for the user the moment a request opens, even mid-turn", () => {
    expect(toneOf(pulseAfter(RESTING, [STARTED, ASKED]))).toBe("waiting");
  });

  it("goes back to working once the request is answered", () => {
    expect(toneOf(pulseAfter(RESTING, [STARTED, ASKED, ANSWERED]))).toBe("running");
  });

  it("rests when the turn ends", () => {
    expect(toneOf(pulseAfter(RESTING, [STARTED, ASKED, ANSWERED, ENDED]))).toBe("idle");
  });

  it("reports a failure over everything else", () => {
    expect(toneOf(pulseAfter(RESTING, [STARTED, ASKED, BROKE]))).toBe("failed");
  });

  it("keeps the pulse it was given when nothing in the batch touches it", () => {
    const before = pulseAfter(RESTING, [STARTED]);

    expect(pulseAfter(before, [])).toBe(before);
  });
});
