import type { SessionEvent } from "../contracts/events";
import type { SessionActivity } from "../contracts/session";

export interface SessionPulse {
  readonly activity: SessionActivity;
  readonly openRequests: number;
}

export const RESTING: SessionPulse = { activity: { kind: "idle" }, openRequests: 0 };

export type PulseTone = "running" | "waiting" | "idle" | "failed";

export function toneOf(pulse: SessionPulse): PulseTone {
  if (pulse.activity.kind === "failed") {
    return "failed";
  }
  if (pulse.openRequests > 0) {
    return "waiting";
  }
  return pulse.activity.kind === "running" ? "running" : "idle";
}

function beat(current: SessionPulse, event: SessionEvent): SessionPulse {
  if (event.type === "turn.started") {
    return {
      activity: { kind: "running", turnId: event.turnId, startedAt: event.at },
      openRequests: current.openRequests,
    };
  }
  if (event.type === "turn.completed") {
    return { activity: { kind: "idle" }, openRequests: current.openRequests };
  }
  if (event.type === "session.failed") {
    return {
      activity: { kind: "failed", reason: event.reason, providerError: event.providerError },
      openRequests: current.openRequests,
    };
  }
  if (event.type === "request.opened") {
    return { activity: current.activity, openRequests: current.openRequests + 1 };
  }
  if (event.type === "request.resolved") {
    return {
      activity: current.activity,
      openRequests: Math.max(current.openRequests - 1, 0),
    };
  }
  return current;
}

export function pulseAfter(current: SessionPulse, events: readonly SessionEvent[]): SessionPulse {
  return events.reduce(beat, current);
}
