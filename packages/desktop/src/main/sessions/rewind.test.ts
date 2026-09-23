import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../contracts/events";
import { projectSession } from "../../contracts/projector";

import { replayedConversation, rewindPoint, transcriptReplay, type RewindPoint } from "./rewind";

const SESSION_ID = "ses_rewind";
const AT = "2026-09-22T12:00:00.000Z";
const SCOPE = { sessionId: SESSION_ID, at: AT };

function turnEvents(turn: number, prompt: string, reply: string, seq: number): SessionEvent[] {
  const turnId = `trn_${turn}`;
  return [
    { ...SCOPE, type: "turn.started", id: `evt_${seq}`, seq, turnId, userMessageId: `msg_${turn}` },
    {
      ...SCOPE,
      type: "user.message",
      id: `evt_${seq + 1}`,
      seq: seq + 1,
      turnId,
      messageId: `msg_${turn}`,
      text: prompt,
      attachments: [],
    },
    {
      ...SCOPE,
      type: "assistant.text",
      id: `evt_${seq + 2}`,
      seq: seq + 2,
      turnId,
      messageId: `reply_${turn}`,
      chunk: { kind: "complete", text: reply },
    },
    {
      ...SCOPE,
      type: "checkpoint.captured",
      id: `evt_${seq + 3}`,
      seq: seq + 3,
      turnId,
      ref: `refs/rde/checkpoints/${SESSION_ID}/${turn}`,
      files: [],
    },
  ];
}

const SNAPSHOT = projectSession([
  {
    ...SCOPE,
    type: "session.created",
    id: "evt_0",
    seq: 0,
    title: "Clean the orders",
    provider: "claude",
    model: null,
    workspace: { kind: "worktree", path: "/work/orders", branch: "rde/orders", base: "main" },
    permissionMode: "ask",
  },
  ...turnEvents(1, "Clean the orders table", "I cleaned it.", 1),
  ...turnEvents(2, "Add a segment", "I added big_orders.", 5),
]);

function requirePoint(turnId: string): RewindPoint {
  const point = rewindPoint(SNAPSHOT, turnId);
  if (point === null) {
    throw new Error(`the session holds no prompt for ${turnId}`);
  }
  return point;
}

describe("rewindPoint", () => {
  it("returns to the checkpoint the turn before the prompt ended on", () => {
    const point = requirePoint("trn_2");
    expect(point.messageId).toBe("msg_2");
    expect(point.checkpointRef).toBe(`refs/rde/checkpoints/${SESSION_ID}/1`);
  });

  it("returns to the baseline from the prompt that opened the session", () => {
    expect(requirePoint("trn_1")).toEqual({
      messageId: "msg_1",
      kept: [],
      checkpointRef: `refs/rde/checkpoints/${SESSION_ID}/0`,
    });
  });

  it("names no point for a turn the session does not hold", () => {
    expect(rewindPoint(SNAPSHOT, "trn_9")).toBeNull();
  });
});

describe("transcriptReplay", () => {
  it("hands a new conversation the prompts and replies up to the point", () => {
    expect(transcriptReplay(requirePoint("trn_2").kept)).toBe(
      [
        "This conversation continues an earlier one in this same checkout. Here is that conversation up to the point the user returned to:",
        "User:\nClean the orders table",
        "Assistant:\nI cleaned it.",
      ].join("\n\n"),
    );
  });

  it("has nothing to replay when nothing was said before the point", () => {
    expect(transcriptReplay([])).toBeNull();
  });
});

describe("replayedConversation", () => {
  it("starts empty when the prompt opened the session, and hands over the transcript otherwise", () => {
    expect(replayedConversation(requirePoint("trn_1").kept)).toEqual({ kind: "fresh" });
    expect(replayedConversation(requirePoint("trn_2").kept)).toEqual({
      kind: "replayed",
      replay: transcriptReplay(requirePoint("trn_2").kept),
    });
  });
});
