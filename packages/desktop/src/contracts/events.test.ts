import { describe, expect, it } from "vitest";

import { SESSION_EVENT_FIXTURES } from "./events.fixtures";
import { SESSION_EVENT_TYPES, SessionEvent } from "./events";

describe("session events", () => {
  it("names every kind the session log can hold", () => {
    expect(SESSION_EVENT_TYPES.toSorted()).toEqual([
      "assistant.reasoning",
      "assistant.text",
      "checkpoint.captured",
      "context.compacted",
      "request.opened",
      "request.resolved",
      "session.created",
      "session.failed",
      "session.rewound",
      "session.updated",
      "sync.completed",
      "tool.completed",
      "tool.started",
      "tool.updated",
      "turn.completed",
      "turn.started",
      "user.message",
    ]);
  });

  it("files each fixture under its own kind", () => {
    const misfiled = Object.entries(SESSION_EVENT_FIXTURES)
      .filter(([type, event]) => event.type !== type)
      .map(([type]) => type);
    expect(misfiled).toEqual([]);
  });

  it("refuses an event whose payload belongs to another kind", () => {
    const result = SessionEvent.safeParse({
      ...SESSION_EVENT_FIXTURES["turn.started"],
      type: "context.compacted",
    });
    expect(result.success).toBe(false);
  });
});
