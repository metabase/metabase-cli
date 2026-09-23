import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SessionEventInput } from "../../../contracts/events";
import type { SessionClock, TurnInput } from "../adapter";

import { readFrames, type RecordedFrame } from "./fixtures";
import { ClaudeMessageMapper } from "./messages";
import type { ClaudeMessage } from "./wire";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures");
const SESSION_ID = "ses_replay";
const TURN_ID = "turn_1";
const MESSAGE_ID = "msg_user_1";
const RECORDED_CWD = "/tmp/claude-1002/rde-record-rLG9";
const RECORDED_SESSION = "58f05503-1f8b-4154-93d7-75200bfc27c2";
const QUESTION_SESSION = "51e58666-373d-437c-ae16-ab45395c7fd5";
const CLOCK_START_MS = Date.parse("2026-09-22T15:23:00.000Z");
const CLOCK_STEP_MS = 1_000;

type EventOf<Type extends SessionEventInput["type"]> = Extract<SessionEventInput, { type: Type }>;

interface Replayed {
  readonly events: readonly SessionEventInput[];
  readonly mapper: ClaudeMessageMapper;
}

const PROMPT_ID = "3b1f7c2e-8d4a-4f6b-9c0e-2a5d7e9f1b3c";

function turnOf(text: string): TurnInput {
  return { turnId: TURN_ID, messageId: MESSAGE_ID, promptId: PROMPT_ID, text, attachments: [] };
}

function countingClock(): SessionClock {
  let ids = 0;
  let ticks = 0;
  return {
    eventId: () => `evt_${++ids}`,
    now: () => new Date(CLOCK_START_MS + ticks++ * CLOCK_STEP_MS).toISOString(),
  };
}

function mapperInto(events: SessionEventInput[]): ClaudeMessageMapper {
  return new ClaudeMessageMapper({
    sessionId: SESSION_ID,
    cwd: RECORDED_CWD,
    clock: countingClock(),
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
  });
}

function feed(mapper: ClaudeMessageMapper, frames: readonly RecordedFrame[]): void {
  for (const frame of frames) {
    if (frame.kind === "message") {
      mapper.applyMessage(frame.message);
      continue;
    }
    mapper.applyPermission(
      {
        requestId: frame.toolUseID,
        toolName: frame.toolName,
        input: frame.input,
        toolUseId: frame.toolUseID,
        title: frame.title,
        hasSuggestions: frame.suggestionCount > 0,
      },
      () => {},
    );
  }
}

async function replay(fixture: string, text: string): Promise<Replayed> {
  const events: SessionEventInput[] = [];
  const mapper = mapperInto(events);
  mapper.beginTurn(turnOf(text));
  feed(mapper, await readFrames(join(FIXTURE_DIR, `${fixture}.jsonl`)));
  return { events, mapper };
}

function only<Type extends SessionEventInput["type"]>(
  events: readonly SessionEventInput[],
  type: Type,
): EventOf<Type> {
  const matches = events.filter((event): event is EventOf<Type> => event.type === type);
  const [first] = matches;
  if (first === undefined || matches.length !== 1) {
    throw new Error(`expected exactly one ${type} event, found ${matches.length}`);
  }
  return first;
}

describe("replaying a recorded write turn", () => {
  it("emits the turn's events in the order the frames arrive", async () => {
    const { events } = await replay("turn", "Create a file named hello.txt containing hello.");

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "tool.started",
      "request.opened",
      "tool.completed",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "turn.completed",
    ]);
  });

  it("labels the write with the file it names", async () => {
    const { events } = await replay("turn", "Create a file named hello.txt containing hello.");

    expect(only(events, "tool.started")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "tool.started",
      callId: "toolu_0122LYTH6pNK2GWcLb3U3VpC",
      tool: "edit",
      label: "Write hello.txt",
      input: { file_path: `${RECORDED_CWD}/hello.txt`, content: "hello\n" },
    });
  });

  it("opens a permission request with allow, always allow and deny", async () => {
    const { events } = await replay("turn", "Create a file named hello.txt containing hello.");

    expect(only(events, "request.opened")).toEqual({
      id: "evt_3",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "request.opened",
      requestId: "toolu_0122LYTH6pNK2GWcLb3U3VpC",
      kind: "permission",
      callId: "toolu_0122LYTH6pNK2GWcLb3U3VpC",
      prompt: "Write hello.txt?",
      options: [
        { id: "allow", label: "Allow", hint: null },
        { id: "allow-always", label: "Always allow", hint: "For the rest of this session" },
        { id: "deny", label: "Deny", hint: null },
      ],
      acceptsText: false,
    });
  });

  it("reports the written file relative to the checkout", async () => {
    const { events } = await replay("turn", "Create a file named hello.txt containing hello.");

    expect(only(events, "tool.completed")).toEqual({
      id: "evt_4",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:03.000Z",
      turnId: TURN_ID,
      type: "tool.completed",
      callId: "toolu_0122LYTH6pNK2GWcLb3U3VpC",
      status: "ok",
      output: `File created successfully at: ${RECORDED_CWD}/hello.txt (file state is current in your context — no need to Read it back)`,
      files: ["hello.txt"],
      patch: null,
    });
  });

  it("carries the result's usage onto the completed turn", async () => {
    const { events } = await replay("turn", "Create a file named hello.txt containing hello.");

    expect(only(events, "turn.completed")).toEqual({
      id: "evt_9",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:08.000Z",
      turnId: TURN_ID,
      type: "turn.completed",
      outcome: { kind: "completed" },
      usage: {
        inputTokens: 4,
        outputTokens: 114,
        cacheReadTokens: 26_187,
        cacheWriteTokens: 5_737,
        costUsd: 0.0742975,
      },
      durationMs: 2_530,
    });
  });
});

describe("replaying a recorded resume", () => {
  it("emits the delete turn's events in the order the frames arrive", async () => {
    const { events } = await replay("resume", "Now delete hello.txt.");

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "tool.started",
      "request.opened",
      "tool.completed",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "turn.completed",
    ]);
  });

  it("labels the delete with the command it runs", async () => {
    const { events } = await replay("resume", "Now delete hello.txt.");

    expect(only(events, "tool.started")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "tool.started",
      callId: "toolu_01Dm2Ur8PEzL2ZKqhZtoSLJe",
      tool: "command",
      label: `Bash rm ${RECORDED_CWD}/hello.txt`,
      input: { command: `rm ${RECORDED_CWD}/hello.txt`, description: "Delete hello.txt" },
    });
  });

  it("completes the delete with no file and no patch to report", async () => {
    const { events } = await replay("resume", "Now delete hello.txt.");

    expect(only(events, "tool.completed")).toEqual({
      id: "evt_4",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:03.000Z",
      turnId: TURN_ID,
      type: "tool.completed",
      callId: "toolu_01Dm2Ur8PEzL2ZKqhZtoSLJe",
      status: "ok",
      output: "(Bash completed with no output)",
      files: [],
      patch: null,
    });
  });

  it("reads the native session id the resumed session reports", async () => {
    const { mapper } = await replay("resume", "Now delete hello.txt.");

    expect(mapper.nativeSessionId).toBe(RECORDED_SESSION);
  });
});

describe("replaying a recorded question", () => {
  it("emits a question request instead of a tool row", async () => {
    const { events } = await replay("question", "Ask me whether to use tabs or spaces.");

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "request.opened",
      "request.resolved",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "assistant.text",
      "turn.completed",
    ]);
  });

  it("offers the asked question's labels as the option ids", async () => {
    const { events } = await replay("question", "Ask me whether to use tabs or spaces.");

    expect(only(events, "request.opened")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "request.opened",
      requestId: "toolu_01Py5aLhw8Xo61XvJjfvvtaq",
      kind: "question",
      callId: null,
      prompt: "Should this repository use tabs or spaces for indentation?",
      options: [
        {
          id: "Spaces",
          label: "Spaces",
          hint: "Indent with spaces (most common default; consistent rendering everywhere)",
        },
        {
          id: "Tabs",
          label: "Tabs",
          hint: "Indent with tab characters (lets each reader set their own indent width; better for accessibility)",
        },
      ],
      acceptsText: true,
    });
  });

  it("resolves the request where the answer lands", async () => {
    const { events } = await replay("question", "Ask me whether to use tabs or spaces.");

    expect(only(events, "request.resolved")).toEqual({
      id: "evt_3",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "request.resolved",
      requestId: "toolu_01Py5aLhw8Xo61XvJjfvvtaq",
      resolution: { kind: "answered", optionId: "Spaces", text: null },
    });
  });

  it("reads the native session id the question session reports", async () => {
    const { mapper } = await replay("question", "Ask me whether to use tabs or spaces.");

    expect(mapper.nativeSessionId).toBe(QUESTION_SESSION);
  });
});

describe("messages outside the mapping", () => {
  const hookStarted: ClaudeMessage = {
    type: "system",
    subtype: "hook_started",
    session_id: RECORDED_SESSION,
    hook_event_name: "PreToolUse",
  };

  const compacted: ClaudeMessage = {
    type: "system",
    subtype: "compact_boundary",
    session_id: RECORDED_SESSION,
    compact_metadata: { trigger: "auto", pre_tokens: 41_000 },
  };

  it("drops a system subtype the timeline has no row for", () => {
    const events: SessionEventInput[] = [];
    const mapper = mapperInto(events);
    mapper.beginTurn(turnOf("Write hello.txt."));

    mapper.applyMessage(hookStarted);

    expect(events.map((event) => event.type)).toEqual([]);
  });

  const editResult: ClaudeMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_edit",
          content: [{ type: "text", text: "The file has been updated." }],
        },
      ],
    },
    tool_use_result: {
      filePath: `${RECORDED_CWD}/notes/plan.md`,
      structuredPatch: [
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ["-old", "+new", "+next"] },
      ],
    },
  };

  it("renders the edit's structured patch as a unified diff", () => {
    const events: SessionEventInput[] = [];
    const mapper = mapperInto(events);
    mapper.beginTurn(turnOf("Update the plan."));

    mapper.applyMessage(editResult);

    expect(only(events, "tool.completed")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:00.000Z",
      turnId: TURN_ID,
      type: "tool.completed",
      callId: "toolu_edit",
      status: "ok",
      output: "The file has been updated.",
      files: ["notes/plan.md"],
      patch: "@@ -3,1 +3,2 @@\n-old\n+new\n+next",
    });
  });

  it("announces a compaction the provider reports", () => {
    const events: SessionEventInput[] = [];
    const mapper = mapperInto(events);
    mapper.beginTurn(turnOf("Write hello.txt."));

    mapper.applyMessage(compacted);

    expect(only(events, "context.compacted")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:00.000Z",
      turnId: TURN_ID,
      type: "context.compacted",
      notice: "Context compacted (auto) from 41000 tokens.",
    });
  });
});

describe("closing a request", () => {
  it("records the option the user chose", () => {
    const events: SessionEventInput[] = [];
    const mapper = mapperInto(events);
    mapper.beginTurn(turnOf("Write hello.txt."));

    mapper.resolveRequest("req_write", { kind: "answered", optionId: "allow", text: null });

    expect(only(events, "request.resolved")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:00.000Z",
      turnId: TURN_ID,
      type: "request.resolved",
      requestId: "req_write",
      resolution: { kind: "answered", optionId: "allow", text: null },
    });
  });

  it("keeps the first close when a stop follows an answer", () => {
    const events: SessionEventInput[] = [];
    const mapper = mapperInto(events);
    mapper.beginTurn(turnOf("Write hello.txt."));

    mapper.resolveRequest("req_write", { kind: "answered", optionId: "deny", text: "not there" });
    mapper.resolveRequest("req_write", { kind: "expired" });

    expect(only(events, "request.resolved").resolution).toEqual({
      kind: "answered",
      optionId: "deny",
      text: "not there",
    });
  });
});
