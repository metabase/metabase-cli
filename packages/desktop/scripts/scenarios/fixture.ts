import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseJson } from "@metabase/client/json";

import type { SessionEvent, Workspace } from "../../src/contracts/events";
import type { SessionIndexEntry } from "../../src/contracts/session";
import { SESSION_STORE_VERSION, SessionIndex } from "../../src/contracts/session";
import { EVENTS_FILE_NAME } from "../../src/main/sessions/log";
import { INDEX_FILE_NAME, SESSIONS_DIR_NAME } from "../../src/main/sessions/store";
import { temporaryDir } from "../scenario";

const SESSION_ID = "ses_fixture";
const TITLE = "A long session";
const START = Date.parse("2026-09-01T09:00:00.000Z");
const TURN_MS = 60_000;
const STEP_MS = 1000;
const TURN_DURATION_MS = 41_000;

export const FIXTURE_WORKSPACE: Workspace = {
  kind: "worktree",
  path: "/tmp/rde-fixture/orders",
  branch: "rde/orders",
  base: "main",
};

export const ROWS_PER_TURN = 4;

const PARAGRAPH = [
  "I read the table and the transform that fills it.",
  "",
  "```sql",
  "select id, status, total",
  "from orders",
  "where created_at > now() - interval '30 days'",
  "```",
  "",
  "The status column is a string where it should be an enum.",
].join("\n");

interface Clock {
  at: number;
}

function stamp(clock: Clock): string {
  clock.at += STEP_MS;
  return new Date(clock.at).toISOString();
}

function turnEvents(turn: number, clock: Clock, seq: number): readonly SessionEvent[] {
  const turnId = `trn_${String(turn)}`;
  const scope = (offset: number): Pick<SessionEvent, "id" | "sessionId" | "seq" | "at"> => ({
    id: `evt_${String(seq + offset)}`,
    sessionId: SESSION_ID,
    seq: seq + offset,
    at: stamp(clock),
  });
  return [
    { ...scope(0), type: "turn.started", turnId, userMessageId: `msg_${turnId}` },
    {
      ...scope(1),
      type: "user.message",
      turnId,
      messageId: `msg_${turnId}`,
      text: `Look at orders again, pass ${String(turn)}.`,
      attachments: [],
    },
    {
      ...scope(2),
      type: "assistant.reasoning",
      turnId,
      messageId: `rsn_${turnId}`,
      chunk: { kind: "complete", text: "Checking the table, then the transform that fills it." },
    },
    {
      ...scope(3),
      type: "tool.started",
      turnId,
      callId: `call_${turnId}_a`,
      tool: "read",
      label: "Read transforms/orders.sql",
      input: null,
    },
    {
      ...scope(4),
      type: "tool.completed",
      turnId,
      callId: `call_${turnId}_a`,
      status: "ok",
      output: "select id, status, total from orders",
      files: ["transforms/orders.sql"],
      patch: null,
    },
    {
      ...scope(5),
      type: "tool.started",
      turnId,
      callId: `call_${turnId}_b`,
      tool: "edit",
      label: "Edit transforms/orders.sql",
      input: null,
    },
    {
      ...scope(6),
      type: "tool.completed",
      turnId,
      callId: `call_${turnId}_b`,
      status: "ok",
      output: "",
      files: ["transforms/orders.sql"],
      patch: "@@ -1 +1 @@\n-select 1\n+select 2\n",
    },
    {
      ...scope(7),
      type: "assistant.text",
      turnId,
      messageId: `asn_${turnId}`,
      chunk: { kind: "complete", text: PARAGRAPH },
    },
    {
      ...scope(8),
      type: "turn.completed",
      turnId,
      outcome: { kind: "completed" },
      usage: null,
      durationMs: TURN_DURATION_MS,
    },
    {
      ...scope(9),
      type: "checkpoint.captured",
      turnId,
      ref: `refs/rde/checkpoints/${SESSION_ID}/${String(turn)}`,
      files: [{ path: "transforms/orders.sql", added: 3, removed: 1 }],
    },
  ];
}

const EVENTS_PER_TURN = 10;

async function writeIndex(root: string, sessions: readonly SessionIndexEntry[]): Promise<void> {
  const index: SessionIndex = { version: SESSION_STORE_VERSION, sessions: [...sessions] };
  await writeFile(join(root, INDEX_FILE_NAME), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export interface FixtureSession {
  readonly userDataDir: string;
  readonly sessionId: string;
  readonly title: string;
  readonly rows: number;
  readonly nextSeq: number;
  readonly endedAt: number;
}

export async function writeFixtureSession(
  turns: number,
  workspace: Workspace,
): Promise<FixtureSession> {
  const userDataDir = await temporaryDir("rde-userdata-");
  const root = join(userDataDir, SESSIONS_DIR_NAME);
  await mkdir(join(root, SESSION_ID), { recursive: true });

  const clock: Clock = { at: START };
  const created: Extract<SessionEvent, { type: "session.created" }> = {
    id: "evt_0",
    sessionId: SESSION_ID,
    seq: 0,
    at: new Date(START).toISOString(),
    type: "session.created",
    title: TITLE,
    provider: "claude",
    model: null,
    workspace,
    permissionMode: "ask",
  };

  const events: SessionEvent[] = [created];
  for (let turn = 1; turn <= turns; turn += 1) {
    clock.at = START + turn * TURN_MS;
    events.push(...turnEvents(turn, clock, 1 + (turn - 1) * EVENTS_PER_TURN));
  }

  const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  await writeFile(join(root, SESSION_ID, EVENTS_FILE_NAME), lines, "utf8");

  const entry: SessionIndexEntry = {
    id: SESSION_ID,
    title: TITLE,
    provider: "claude",
    workspace: created.workspace,
    lifecycle: "active",
    pinned: false,
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(clock.at).toISOString(),
  };
  await writeIndex(root, [entry]);

  return {
    userDataDir,
    sessionId: SESSION_ID,
    title: TITLE,
    rows: turns * ROWS_PER_TURN,
    nextSeq: events.length,
    endedAt: clock.at,
  };
}

export interface QuietSession {
  readonly id: string;
  readonly title: string;
  readonly workspace: Workspace;
  readonly pinned: boolean;
}

// Sessions opened and never sent a turn, listed after the fixture's long one, so the sidebar has a
// list to show without an agent.
export async function addQuietSessions(
  fixture: FixtureSession,
  sessions: readonly QuietSession[],
): Promise<void> {
  const root = join(fixture.userDataDir, SESSIONS_DIR_NAME);
  const index = parseJson(await readFile(join(root, INDEX_FILE_NAME), "utf8"), SessionIndex);
  const entries = await Promise.all(
    sessions.map(async (session, order): Promise<SessionIndexEntry> => {
      const at = new Date(START - (order + 1) * TURN_MS).toISOString();
      const created: SessionEvent = {
        id: "evt_0",
        sessionId: session.id,
        seq: 0,
        at,
        type: "session.created",
        title: session.title,
        provider: "claude",
        model: null,
        workspace: session.workspace,
        permissionMode: "ask",
      };
      await mkdir(join(root, session.id), { recursive: true });
      await writeFile(
        join(root, session.id, EVENTS_FILE_NAME),
        `${JSON.stringify(created)}\n`,
        "utf8",
      );
      return {
        id: session.id,
        title: session.title,
        provider: "claude",
        workspace: session.workspace,
        lifecycle: "active",
        pinned: session.pinned,
        createdAt: at,
        updatedAt: at,
      };
    }),
  );
  await writeIndex(root, [...index.sessions, ...entries]);
}

const FAILED_TURN_ID = "trn_failed";
const FAILED_TURN_MS = 12_000;
export const FAILED_TURN_MESSAGE =
  "Claude Code stopped in the middle of this turn. Send a message to carry on; the conversation picks up where it stopped.";

// A turn whose agent died mid-way, as the log records one: the running command closed as an error
// and the turn closed as failed.
export async function appendFailedTurn(fixture: FixtureSession): Promise<void> {
  const clock: Clock = { at: fixture.endedAt + TURN_MS };
  const scope = (offset: number): Pick<SessionEvent, "id" | "sessionId" | "seq" | "at"> => ({
    id: `evt_${String(fixture.nextSeq + offset)}`,
    sessionId: SESSION_ID,
    seq: fixture.nextSeq + offset,
    at: stamp(clock),
  });
  const turnId = FAILED_TURN_ID;
  const events: readonly SessionEvent[] = [
    { ...scope(0), type: "turn.started", turnId, userMessageId: `msg_${turnId}` },
    {
      ...scope(1),
      type: "user.message",
      turnId,
      messageId: `msg_${turnId}`,
      text: "Validate the orders transform and sync it.",
      attachments: [],
    },
    {
      ...scope(2),
      type: "tool.started",
      turnId,
      callId: `call_${turnId}`,
      tool: "command",
      label: "mb validate transforms/orders.yaml",
      input: null,
    },
    {
      ...scope(3),
      type: "tool.completed",
      turnId,
      callId: `call_${turnId}`,
      status: "error",
      output: "Claude Code stopped before this finished.",
      files: [],
      patch: null,
    },
    {
      ...scope(4),
      type: "turn.completed",
      turnId,
      outcome: { kind: "failed", message: FAILED_TURN_MESSAGE },
      usage: null,
      durationMs: FAILED_TURN_MS,
    },
  ];
  const path = join(fixture.userDataDir, SESSIONS_DIR_NAME, SESSION_ID, EVENTS_FILE_NAME);
  await appendFile(path, events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
}
