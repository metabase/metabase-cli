import { describe, expect, it } from "vitest";

import { SESSION_EVENT_FIXTURES } from "./events.fixtures";
import { SESSION_EVENT_TYPES, SessionEvent, type SessionEventType } from "./events";
import { SessionLogError, pendingRequests, projectSession } from "./projector";
import type { SessionSnapshot, TimelineItem } from "./session";

const FIXTURE = SESSION_EVENT_FIXTURES;

interface ProjectionCase {
  readonly after: readonly SessionEventType[];
  readonly check: (snapshot: SessionSnapshot) => void;
}

function lastItem(snapshot: SessionSnapshot): TimelineItem {
  const item = snapshot.items[snapshot.items.length - 1];
  if (item === undefined) {
    throw new Error("the projection holds no timeline item");
  }
  return item;
}

type ItemOf<Kind extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: Kind }>;

function toolItem(snapshot: SessionSnapshot): ItemOf<"tool"> {
  const found = snapshot.items.find((item) => item.kind === "tool");
  if (found?.kind !== "tool") {
    throw new Error("the projection holds no tool item");
  }
  return found;
}

function requestItem(snapshot: SessionSnapshot): ItemOf<"request"> {
  const found = snapshot.items.find((item) => item.kind === "request");
  if (found?.kind !== "request") {
    throw new Error("the projection holds no request item");
  }
  return found;
}

function reasoningItem(snapshot: SessionSnapshot): ItemOf<"reasoning"> {
  const found = snapshot.items.find((item) => item.kind === "reasoning");
  if (found?.kind !== "reasoning") {
    throw new Error("the projection holds no reasoning item");
  }
  return found;
}

const TURN_PRELUDE: readonly SessionEventType[] = ["turn.started"];

const CASES: Readonly<Record<SessionEventType, ProjectionCase>> = {
  "session.created": {
    after: [],
    check: (snapshot) => {
      expect(snapshot.session).toEqual({
        id: "ses_7c1f",
        title: "Clean the orders table",
        provider: "claude",
        model: "claude-opus-4",
        workspace: {
          kind: "worktree",
          path: "/repo/.rde/orders",
          branch: "rde/orders",
          base: "main",
        },
        permissionMode: "ask",
        nativeSessionId: null,
        replay: null,
        lastCheckpointSeq: 0,
        slashCommands: [],
        activity: { kind: "idle" },
        createdAt: "2026-09-22T12:00:00.000Z",
        updatedAt: "2026-09-22T12:00:00.000Z",
      });
      expect(snapshot.items).toEqual([]);
    },
  },
  "session.updated": {
    after: [],
    check: (snapshot) => {
      expect(snapshot.session.nativeSessionId).toBe("9f2c1c1e-6a2f-4f1a-9a0c-0d3b7f2a5e11");
      expect(snapshot.session.title).toBe("Clean the orders table");
    },
  },
  "session.failed": {
    after: [],
    check: (snapshot) => {
      expect(snapshot.session.activity).toEqual({
        kind: "failed",
        reason: "the agent process exited before the turn started",
        providerError: "spawn claude ENOENT",
      });
    },
  },
  "turn.started": {
    after: [],
    check: (snapshot) => {
      expect(snapshot.session.activity).toEqual({
        kind: "running",
        turnId: "trn_04",
        startedAt: "2026-09-22T12:00:00.000Z",
      });
      expect(snapshot.items).toEqual([]);
    },
  },
  "turn.completed": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(snapshot.session.activity).toEqual({ kind: "idle" });
      expect(lastItem(snapshot)).toEqual({
        kind: "turn",
        id: "evt_015",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        outcome: { kind: "completed" },
        usage: {
          inputTokens: 1842,
          outputTokens: 311,
          cacheReadTokens: 10234,
          cacheWriteTokens: 0,
          costUsd: 0.0412,
        },
        durationMs: 8731,
      });
    },
  },
  "user.message": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "user",
        id: "evt_006",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        messageId: "msg_01",
        text: "Add a transform test for orders_clean.",
        attachments: ["transforms/orders_clean.yaml"],
      });
    },
  },
  "assistant.text": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "assistant",
        id: "evt_008",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        messageId: "msg_03",
        text: "I added the test and ran it.",
      });
    },
  },
  "assistant.reasoning": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "reasoning",
        id: "evt_007",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        messageId: "msg_02",
        text: "The transform writes to orders_clean, so the test asserts",
      });
    },
  },
  "tool.started": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "tool",
        id: "evt_009",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        callId: "toolu_01",
        tool: "edit",
        label: "Write transform-tests/orders_clean.yaml",
        input: {
          file_path: "transform-tests/orders_clean.yaml",
          content: "name: orders_clean\n",
        },
        state: { kind: "running" },
        output: "",
        files: [],
        patch: null,
      });
    },
  },
  "tool.updated": {
    after: [...TURN_PRELUDE, "tool.started"],
    check: (snapshot) => {
      const tool = toolItem(snapshot);
      expect(tool.output).toBe("1 test, 1 passed\n");
      expect(tool.state).toEqual({ kind: "running" });
    },
  },
  "tool.completed": {
    after: [...TURN_PRELUDE, "tool.started"],
    check: (snapshot) => {
      const tool = toolItem(snapshot);
      expect(tool.state).toEqual({ kind: "finished", status: "ok" });
      expect(tool.files).toEqual(["transform-tests/orders_clean.yaml"]);
      expect(tool.patch).toBe("@@ -0,0 +1 @@\n+name: orders_clean\n");
    },
  },
  "request.opened": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      const request = requestItem(snapshot);
      expect(request.resolution).toBeNull();
      expect(pendingRequests(snapshot)).toEqual([
        {
          requestId: "req_01",
          turnId: "trn_04",
          prompt: "Write transform-tests/orders_clean.yaml?",
          options: [
            { id: "allow", label: "Allow once", hint: null },
            { id: "allow-always", label: "Allow every write in this session", hint: null },
            { id: "deny", label: "Deny", hint: "The agent is told the write was refused" },
          ],
          acceptsText: false,
        },
      ]);
    },
  },
  "request.resolved": {
    after: [...TURN_PRELUDE, "request.opened"],
    check: (snapshot) => {
      expect(requestItem(snapshot).resolution).toEqual({
        kind: "answered",
        optionId: "allow",
        text: null,
      });
      expect(pendingRequests(snapshot)).toEqual([]);
    },
  },
  "checkpoint.captured": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "checkpoint",
        id: "evt_016",
        at: "2026-09-22T12:00:00.000Z",
        turnId: "trn_04",
        ref: "refs/rde/checkpoints/ses_7c1f/1",
        files: [{ path: "transform-tests/orders_clean.yaml", added: 12, removed: 0 }],
      });
    },
  },
  "sync.completed": {
    after: [],
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "sync",
        id: "evt_004",
        at: "2026-09-22T12:00:00.000Z",
        branch: "rde/orders",
        outcome: { kind: "imported", links: [] },
      });
    },
  },
  "session.rewound": {
    after: ["session.updated", "turn.started", "user.message", "checkpoint.captured"],
    check: (snapshot) => {
      expect(snapshot.items).toEqual([
        {
          kind: "notice",
          id: "evt_017",
          at: "2026-09-22T12:00:00.000Z",
          text: "Edited from an earlier prompt. The files are back to how they were before it. Claude Code could not rewind its own conversation, so a new one starts with the transcript up to here.",
        },
      ]);
      expect(snapshot.session.nativeSessionId).toBeNull();
      expect(snapshot.session.replay).toBe("User:\nClean the orders table");
      expect(snapshot.session.lastCheckpointSeq).toBe(2);
    },
  },
  "context.compacted": {
    after: TURN_PRELUDE,
    check: (snapshot) => {
      expect(lastItem(snapshot)).toEqual({
        kind: "notice",
        id: "evt_014",
        at: "2026-09-22T12:00:00.000Z",
        text: "The conversation was summarised to free context.",
      });
    },
  },
};

const CASE_KINDS: readonly SessionEventType[] = SESSION_EVENT_TYPES;

function sequenceFor(type: SessionEventType): SessionEvent[] {
  const kase = CASES[type];
  const events = [FIXTURE["session.created"], ...kase.after.map((name) => FIXTURE[name])];
  return type === "session.created" ? events : [...events, FIXTURE[type]];
}

describe("projectSession", () => {
  for (const name of CASE_KINDS) {
    it(`projects ${name}`, () => {
      CASES[name].check(projectSession(sequenceFor(name)));
    });
  }

  it("carries the last event's sequence number so a push can be placed against it", () => {
    expect(projectSession(sequenceFor("turn.completed")).lastSeq).toBe(15);
  });

  it("refuses a log that opens on anything but the session's creation", () => {
    expect(() => projectSession([FIXTURE["turn.started"]])).toThrow(
      "a session log opens on turn.started, not session.created",
    );
  });

  it("refuses an empty log", () => {
    expect(() => projectSession([])).toThrow("a session log is empty, so it names no session");
  });

  it("refuses a tool report for a call that never started", () => {
    const events = [FIXTURE["session.created"], FIXTURE["turn.started"], FIXTURE["tool.updated"]];
    expect(() => projectSession(events)).toThrow(SessionLogError);
    expect(() => projectSession(events)).toThrow(
      "tool call toolu_01 was reported before it started",
    );
  });

  it("appends a text delta to the message already on screen", () => {
    const first = FIXTURE["assistant.reasoning"];
    const events = [
      FIXTURE["session.created"],
      FIXTURE["turn.started"],
      first,
      SessionEvent.parse({
        ...first,
        id: "evt_007b",
        seq: 8,
        chunk: { kind: "delta", text: " the row count." },
      }),
    ];
    expect(reasoningItem(projectSession(events)).text).toBe(
      "The transform writes to orders_clean, so the test asserts the row count.",
    );
  });
});
