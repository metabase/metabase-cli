import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../contracts/events";
import type { SessionSnapshot } from "../../contracts/session";
import { projectSession } from "../../contracts/projector";

import type { TimelineRow, TimelineRowKind, TimelineView } from "./rows";
import { WORKING_LABEL, WAITING_LABEL, WORKING_ROW_ID, buildRows } from "./rows";

const SESSION_ID = "ses_1";
const AT = "2026-09-22T12:00:00.000Z";
const NOTHING_EXPANDED: TimelineView = { expandedTurns: new Set<string>() };

let nextSeq = 0;

function scope(): Pick<SessionEvent, "id" | "sessionId" | "seq" | "at"> {
  nextSeq += 1;
  return { id: `evt_${String(nextSeq)}`, sessionId: SESSION_ID, seq: nextSeq, at: AT };
}

function created(): SessionEvent {
  return {
    ...scope(),
    type: "session.created",
    title: "Clean the orders table",
    provider: "claude",
    model: null,
    workspace: { kind: "worktree", path: "/w", branch: "rde/orders", base: "main" },
    permissionMode: "ask",
  };
}

function turnStarted(turnId: string): SessionEvent {
  return { ...scope(), type: "turn.started", turnId, userMessageId: `msg_${turnId}` };
}

function userMessage(turnId: string, text: string): SessionEvent {
  return {
    ...scope(),
    type: "user.message",
    turnId,
    messageId: `msg_${turnId}`,
    text,
    attachments: [],
  };
}

function assistantText(turnId: string, messageId: string, text: string): SessionEvent {
  return {
    ...scope(),
    type: "assistant.text",
    turnId,
    messageId,
    chunk: { kind: "delta", text },
  };
}

function reasoning(turnId: string, messageId: string, text: string): SessionEvent {
  return {
    ...scope(),
    type: "assistant.reasoning",
    turnId,
    messageId,
    chunk: { kind: "delta", text },
  };
}

function toolStarted(turnId: string, callId: string, label: string): SessionEvent {
  return { ...scope(), type: "tool.started", turnId, callId, tool: "command", label, input: null };
}

interface ToolEnd {
  readonly status: "ok" | "error";
  readonly files: readonly string[];
}

function toolCompleted(turnId: string, callId: string, end: ToolEnd): SessionEvent {
  return {
    ...scope(),
    type: "tool.completed",
    turnId,
    callId,
    status: end.status,
    output: "",
    files: [...end.files],
    patch: null,
  };
}

function requestOpened(
  turnId: string,
  requestId: string,
  callId: string | null = null,
): SessionEvent {
  return {
    ...scope(),
    type: "request.opened",
    turnId,
    requestId,
    kind: "permission",
    callId,
    prompt: "Write hello.txt?",
    options: [{ id: "allow", label: "Allow", hint: null }],
    acceptsText: false,
  };
}

function checkpoint(turnId: string, ref: string): SessionEvent {
  return {
    ...scope(),
    type: "checkpoint.captured",
    turnId,
    ref,
    files: [{ path: "hello.txt", added: 1, removed: 0 }],
  };
}

function turnCompleted(turnId: string, outcome: "completed" | "interrupted"): SessionEvent {
  return {
    ...scope(),
    type: "turn.completed",
    turnId,
    outcome: outcome === "completed" ? { kind: "completed" } : { kind: "interrupted" },
    usage: null,
    durationMs: 41_000,
  };
}

function compacted(turnId: string): SessionEvent {
  return { ...scope(), type: "context.compacted", turnId, notice: "Context compacted" };
}

function snapshotOf(events: readonly SessionEvent[]): SessionSnapshot {
  nextSeq = 0;
  return projectSession(events);
}

function kinds(rows: readonly TimelineRow[]): readonly TimelineRowKind[] {
  return rows.map((row) => row.kind);
}

function settledTurn(turnId: string, text: string): readonly SessionEvent[] {
  return [
    turnStarted(turnId),
    userMessage(turnId, text),
    reasoning(turnId, `rsn_${turnId}`, "Considering"),
    toolStarted(turnId, `call_${turnId}_a`, "Read orders.sql"),
    toolCompleted(turnId, `call_${turnId}_a`, { status: "ok", files: ["orders.sql"] }),
    toolStarted(turnId, `call_${turnId}_b`, "Write orders.sql"),
    toolCompleted(turnId, `call_${turnId}_b`, { status: "ok", files: ["orders.sql"] }),
    assistantText(turnId, `asn_${turnId}`, "Done."),
    turnCompleted(turnId, "completed"),
    checkpoint(turnId, `refs/rde/checkpoints/${SESSION_ID}/1`),
  ];
}

describe("grouping tool calls", () => {
  it("makes one activity row of a stretch of calls in the same turn", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read a"),
      toolCompleted("t1", "c1", { status: "ok", files: [] }),
      toolStarted("t1", "c2", "Read b"),
      toolCompleted("t1", "c2", { status: "ok", files: [] }),
    ]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);

    expect(kinds(rows)).toEqual(["user", "activity", "working"]);
    const activity = rows[1];
    expect(activity?.kind === "activity" ? activity.tools.map((tool) => tool.label) : []).toEqual([
      "Read a",
      "Read b",
    ]);
  });

  it("breaks the stretch where the agent says something", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read a"),
      toolCompleted("t1", "c1", { status: "ok", files: [] }),
      assistantText("t1", "a1", "Halfway there."),
      toolStarted("t1", "c2", "Read b"),
      toolCompleted("t1", "c2", { status: "ok", files: [] }),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual([
      "user",
      "activity",
      "assistant",
      "activity",
      "working",
    ]);
  });

  it("reports a group as failed when any one of its calls failed", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read a"),
      toolCompleted("t1", "c1", { status: "error", files: [] }),
      toolStarted("t1", "c2", "Read b"),
      toolCompleted("t1", "c2", { status: "ok", files: [] }),
    ]);

    const activity = buildRows(snapshot, NOTHING_EXPANDED)[1];

    expect(activity?.kind === "activity" ? activity.status : null).toBe("error");
  });

  it("reports a group as running while one of its calls is still open", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read a"),
      toolCompleted("t1", "c1", { status: "ok", files: [] }),
      toolStarted("t1", "c2", "Read b"),
    ]);

    const activity = buildRows(snapshot, NOTHING_EXPANDED)[1];

    expect(activity?.kind === "activity" ? activity.status : null).toBe("running");
  });
});

describe("folding a settled turn", () => {
  it("hides the reasoning and the activity behind one row and keeps the conversation", () => {
    const snapshot = snapshotOf([created(), ...settledTurn("t1", "go")]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);

    expect(kinds(rows)).toEqual(["user", "fold", "assistant", "checkpoint"]);
    const fold = rows[1];
    expect(fold?.kind === "fold" ? fold.fold : null).toEqual({
      toolCalls: 2,
      filesChanged: 1,
      durationMs: 41_000,
      outcome: { kind: "completed" },
    });
  });

  it("leaves a turn the user opened unfolded", () => {
    const snapshot = snapshotOf([created(), ...settledTurn("t1", "go")]);

    const rows = buildRows(snapshot, { expandedTurns: new Set(["t1"]) });

    expect(kinds(rows)).toEqual(["user", "reasoning", "activity", "assistant", "checkpoint"]);
  });

  it("never folds the turn that is still running", () => {
    const snapshot = snapshotOf([
      created(),
      ...settledTurn("t1", "first"),
      turnStarted("t2"),
      userMessage("t2", "second"),
      reasoning("t2", "rsn_t2", "Thinking"),
      toolStarted("t2", "c9", "Read c"),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual([
      "user",
      "fold",
      "assistant",
      "checkpoint",
      "user",
      "reasoning",
      "activity",
      "working",
    ]);
  });

  it("keeps a failed group out of the fold", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read a"),
      toolCompleted("t1", "c1", { status: "error", files: [] }),
      turnCompleted("t1", "completed"),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual(["user", "activity"]);
  });

  it("writes no fold row for a turn whose work is all still on screen", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      assistantText("t1", "a1", "Nothing to do."),
      turnCompleted("t1", "completed"),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual(["user", "assistant"]);
  });

  it("keeps a request and a notice out of the fold", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      reasoning("t1", "r1", "Considering"),
      requestOpened("t1", "req_1"),
      compacted("t1"),
      turnCompleted("t1", "completed"),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual([
      "user",
      "fold",
      "request",
      "notice",
    ]);
  });

  it("shows a turn the user stopped and hides one that ran to its end", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      turnCompleted("t1", "interrupted"),
    ]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).toEqual(["user", "turn"]);
  });
});

describe("the working row", () => {
  it("is absent while the session is idle", () => {
    const snapshot = snapshotOf([created(), ...settledTurn("t1", "go")]);

    expect(kinds(buildRows(snapshot, NOTHING_EXPANDED))).not.toContain("working");
  });

  it("is the one last row while a turn runs, and carries the running call's label", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read orders.sql"),
    ]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);
    const working = rows.at(-1);

    expect(rows.filter((row) => row.kind === "working")).toHaveLength(1);
    expect(working).toEqual({
      kind: "working",
      id: WORKING_ROW_ID,
      turnId: "t1",
      startedAt: AT,
      label: "Read orders.sql",
    });
  });

  it("says the turn waits for the user while a request is open, and marks the call it gates", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Write orders.sql"),
      requestOpened("t1", "r1", "c1"),
    ]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);
    const activity = rows.find((row) => row.kind === "activity");
    const working = rows.at(-1);

    expect(working?.kind === "working" ? working.label : null).toBe(WAITING_LABEL);
    expect(activity?.kind === "activity" ? [...activity.awaiting] : null).toEqual(["c1"]);
  });

  it("keeps the label of a call that has just finished well", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read orders.sql"),
      toolCompleted("t1", "c1", { status: "ok", files: [] }),
    ]);

    const working = buildRows(snapshot, NOTHING_EXPANDED).at(-1);

    expect(working?.kind === "working" ? working.label : null).toBe("Read orders.sql");
  });

  it("falls back to its own word after a call that failed", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      toolStarted("t1", "c1", "Read orders.sql"),
      toolCompleted("t1", "c1", { status: "error", files: [] }),
    ]);

    const working = buildRows(snapshot, NOTHING_EXPANDED).at(-1);

    expect(working?.kind === "working" ? working.label : null).toBe(WORKING_LABEL);
  });
});

describe("marking the text that is still arriving", () => {
  it("marks the last message of the running turn and nothing else", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      assistantText("t1", "a1", "Halfway"),
      assistantText("t1", "a2", "there"),
    ]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);
    const streaming = rows.filter((row) => row.kind === "assistant" && row.streaming);

    expect(streaming.map((row) => row.id)).toEqual([rows[2]?.id]);
  });

  it("marks nothing once the turn has ended", () => {
    const snapshot = snapshotOf([
      created(),
      turnStarted("t1"),
      userMessage("t1", "go"),
      assistantText("t1", "a1", "Done."),
      turnCompleted("t1", "completed"),
    ]);

    const rows = buildRows(snapshot, NOTHING_EXPANDED);

    expect(rows.some((row) => row.kind === "assistant" && row.streaming)).toBe(false);
  });
});
