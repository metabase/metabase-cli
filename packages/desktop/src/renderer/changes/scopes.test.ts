import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../contracts/events";
import { projectSession } from "../../contracts/projector";

import { liveScope, restoreTarget, turnScopes } from "./scopes";

const SESSION_ID = "ses_scopes";
const SCOPE = { sessionId: SESSION_ID, at: "2026-09-22T12:00:00.000Z" };

function prompt(turnId: string, seq: number): SessionEvent[] {
  return [
    { ...SCOPE, type: "turn.started", id: `evt_${seq}`, seq, turnId, userMessageId: `msg_${seq}` },
    {
      ...SCOPE,
      type: "user.message",
      id: `evt_${seq + 1}`,
      seq: seq + 1,
      turnId,
      messageId: `msg_${seq}`,
      text: "Clean the orders",
      attachments: [],
    },
  ];
}

function checkpoint(turnId: string, seq: number, ref: number): SessionEvent {
  return {
    ...SCOPE,
    type: "checkpoint.captured",
    id: `evt_${seq}`,
    seq,
    turnId,
    ref: `refs/rde/checkpoints/${SESSION_ID}/${ref}`,
    files: [],
  };
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
  ...prompt("trn_a", 1),
  checkpoint("trn_a", 3, 1),
  ...prompt("trn_b", 4),
  ...prompt("trn_c", 6),
  checkpoint("trn_c", 8, 2),
]);

describe("turnScopes", () => {
  it("offers each turn that captured a checkpoint, numbered by the prompts sent", () => {
    expect(turnScopes(SNAPSHOT)).toEqual([
      { turnId: "trn_a", label: "Turn 1" },
      { turnId: "trn_c", label: "Turn 3" },
    ]);
  });
});

describe("restoreTarget", () => {
  it("says a revert in the whole view returns the file to the session's start", () => {
    expect(restoreTarget(SNAPSHOT, { kind: "all" })).toBe("how it was when the session started");
  });

  it("says a revert in one turn's view returns the file to before that turn", () => {
    expect(restoreTarget(SNAPSHOT, { kind: "turn", turnId: "trn_c" })).toBe(
      "how it was before turn 3",
    );
  });
});

describe("liveScope", () => {
  it("keeps a turn the session still holds", () => {
    expect(liveScope(SNAPSHOT, { kind: "turn", turnId: "trn_a" })).toEqual({
      kind: "turn",
      turnId: "trn_a",
    });
  });

  it("falls back to the whole session for a turn an edit dropped", () => {
    expect(liveScope(SNAPSHOT, { kind: "turn", turnId: "trn_gone" })).toEqual({ kind: "all" });
  });
});
