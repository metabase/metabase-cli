import { join } from "node:path";

import { parseJson } from "@metabase/client/json";
import { describe, expect, it } from "vitest";

import type { SessionEventInput } from "../../../contracts/events";
import type { SessionClock, TurnInput } from "../adapter";

import { readRecording } from "./fixtures";
import { CodexMessageMapper } from "./messages";
import { AnyResult, routeFrame, type CodexNotification } from "./protocol";
import type { ApprovalAsk, QuestionAsk } from "./requests";

// Every notification below is built to the shapes in protocol.ts; the recorded handshake at the
// end of the file is the only part the wire itself wrote.

const SESSION_ID = "ses_codex";
const TURN_ID = "turn_1";
const MESSAGE_ID = "msg_user_1";
const CWD = "/tmp/rde-codex";
const THREAD_ID = "01a0c9ba-e99b-71f0-9c81-1a4bb673a91e";
const CODEX_TURN_ID = "01a0c9ba-ed7a-7163-bf46-6856e3963d09";
const CLOCK_START_MS = Date.parse("2026-09-22T15:23:00.000Z");
const CLOCK_STEP_MS = 1_000;

type EventOf<Type extends SessionEventInput["type"]> = Extract<SessionEventInput, { type: Type }>;

function countingClock(): SessionClock {
  let ids = 0;
  let ticks = 0;
  return {
    eventId: () => `evt_${++ids}`,
    now: () => new Date(CLOCK_START_MS + ticks++ * CLOCK_STEP_MS).toISOString(),
  };
}

const PROMPT_ID = "3b1f7c2e-8d4a-4f6b-9c0e-2a5d7e9f1b3c";

function turnOf(text: string): TurnInput {
  return { turnId: TURN_ID, messageId: MESSAGE_ID, promptId: PROMPT_ID, text, attachments: [] };
}

interface Driven {
  readonly events: SessionEventInput[];
  readonly mapper: CodexMessageMapper;
}

function opened(text: string): Driven {
  const events: SessionEventInput[] = [];
  const mapper = new CodexMessageMapper({
    sessionId: SESSION_ID,
    cwd: CWD,
    clock: countingClock(),
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
  });
  mapper.beginTurn(turnOf(text));
  return { events, mapper };
}

function notification(method: string, params: unknown): CodexNotification {
  return { kind: "notification", method, params };
}

function itemFrame(method: string, item: unknown): CodexNotification {
  return notification(method, { threadId: THREAD_ID, turnId: CODEX_TURN_ID, item });
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

const COMMAND_ITEM = {
  type: "commandExecution",
  id: "item_cmd",
  command: "rm hello.txt",
  cwd: CWD,
  status: "inProgress",
  commandActions: [],
};

const COMMAND_DONE = {
  ...COMMAND_ITEM,
  status: "completed",
  aggregatedOutput: "removed 'hello.txt'\n",
  exitCode: 0,
};

const FILE_CHANGE_ITEM = {
  type: "fileChange",
  id: "item_edit",
  status: "inProgress",
  changes: [{ path: `${CWD}/hello.txt`, diff: "@@ -0,0 +1 @@\n+hello", kind: { type: "add" } }],
};

describe("a command execution", () => {
  it("opens a command row when the item starts", () => {
    const codex = opened("Delete hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", COMMAND_ITEM));

    expect(only(codex.events, "tool.started")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "tool.started",
      callId: "item_cmd",
      tool: "command",
      label: "rm hello.txt",
      input: COMMAND_ITEM,
    });
  });

  it("appends the output delta to the row it names", () => {
    const codex = opened("Delete hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", COMMAND_ITEM));
    codex.mapper.applyNotification(
      notification("item/commandExecution/outputDelta", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        itemId: "item_cmd",
        delta: "removed 'hello.txt'\n",
      }),
    );

    expect(only(codex.events, "tool.updated")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "tool.updated",
      callId: "item_cmd",
      progress: { kind: "output", text: "removed 'hello.txt'\n" },
    });
  });

  it("closes the row with the aggregated output the item carries", () => {
    const codex = opened("Delete hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", COMMAND_ITEM));
    codex.mapper.applyNotification(itemFrame("item/completed", COMMAND_DONE));

    expect(only(codex.events, "tool.completed")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "tool.completed",
      callId: "item_cmd",
      status: "ok",
      output: "removed 'hello.txt'\n",
      files: [],
      patch: null,
    });
  });
});

describe("a file change", () => {
  it("labels the row with the path it changes, relative to the checkout", () => {
    const codex = opened("Write hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", FILE_CHANGE_ITEM));

    expect(only(codex.events, "tool.started")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "tool.started",
      callId: "item_edit",
      tool: "edit",
      label: "hello.txt",
      input: FILE_CHANGE_ITEM,
    });
  });

  it("closes the row with the patch built from its changes", () => {
    const codex = opened("Write hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", FILE_CHANGE_ITEM));
    codex.mapper.applyNotification(
      itemFrame("item/completed", { ...FILE_CHANGE_ITEM, status: "completed" }),
    );

    expect(only(codex.events, "tool.completed")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "tool.completed",
      callId: "item_edit",
      status: "ok",
      output: "",
      files: ["hello.txt"],
      patch: "hello.txt\n@@ -0,0 +1 @@\n+hello",
    });
  });
});

describe("an assistant message", () => {
  it("streams its deltas and completes with the whole text", () => {
    const codex = opened("Say hello.");

    codex.mapper.applyNotification(
      notification("item/agentMessage/delta", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        itemId: "item_msg",
        delta: "Done",
      }),
    );
    codex.mapper.applyNotification(
      notification("item/agentMessage/delta", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        itemId: "item_msg",
        delta: ".",
      }),
    );
    codex.mapper.applyNotification(
      itemFrame("item/completed", { type: "agentMessage", id: "item_msg", text: "Done." }),
    );

    expect(codex.events.filter((event) => event.type === "assistant.text")).toEqual([
      {
        id: "evt_1",
        sessionId: SESSION_ID,
        at: "2026-09-22T15:23:01.000Z",
        turnId: TURN_ID,
        type: "assistant.text",
        messageId: "item_msg",
        chunk: { kind: "delta", text: "Done" },
      },
      {
        id: "evt_2",
        sessionId: SESSION_ID,
        at: "2026-09-22T15:23:02.000Z",
        turnId: TURN_ID,
        type: "assistant.text",
        messageId: "item_msg",
        chunk: { kind: "delta", text: "." },
      },
      {
        id: "evt_3",
        sessionId: SESSION_ID,
        at: "2026-09-22T15:23:03.000Z",
        turnId: TURN_ID,
        type: "assistant.text",
        messageId: "item_msg",
        chunk: { kind: "complete", text: "Done." },
      },
    ]);
  });
});

describe("an approval Codex asks for", () => {
  const ask: ApprovalAsk = {
    requestId: "req_1",
    kind: "command",
    itemId: "item_cmd",
    detail: "rm hello.txt",
  };

  it("opens a permission request naming the row it belongs to", () => {
    const codex = opened("Delete hello.txt.");

    codex.mapper.applyNotification(itemFrame("item/started", COMMAND_ITEM));
    codex.mapper.openApproval(ask);

    expect(only(codex.events, "request.opened")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "request.opened",
      requestId: "req_1",
      kind: "permission",
      callId: "item_cmd",
      prompt: "Allow rm hello.txt?",
      options: [
        { id: "accept", label: "Allow", hint: null },
        { id: "acceptForSession", label: "Always allow", hint: "For the rest of this session" },
        { id: "decline", label: "Decline", hint: null },
        { id: "cancel", label: "Cancel", hint: null },
      ],
      acceptsText: false,
    });
  });

  it("records the option the user chose once", () => {
    const codex = opened("Delete hello.txt.");

    codex.mapper.openApproval(ask);
    codex.mapper.resolveRequest("req_1", { kind: "answered", optionId: "accept", text: null });
    codex.mapper.resolveRequest("req_1", { kind: "expired" });

    expect(only(codex.events, "request.resolved")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "request.resolved",
      requestId: "req_1",
      resolution: { kind: "answered", optionId: "accept", text: null },
    });
  });
});

describe("a question Codex asks", () => {
  const ask: QuestionAsk = {
    requestId: "req_1:q1",
    itemId: "item_tool",
    question: {
      id: "q1",
      question: "Should this repository use tabs or spaces?",
      options: [
        { label: "Spaces", description: "Indent with spaces" },
        { label: "Tabs", description: "" },
      ],
    },
  };

  it("opens a question request offering the labels as option ids", () => {
    const codex = opened("Ask me about indentation.");

    codex.mapper.openQuestions([ask]);

    expect(only(codex.events, "request.opened")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "request.opened",
      requestId: "req_1:q1",
      kind: "question",
      callId: "item_tool",
      prompt: "Should this repository use tabs or spaces?",
      options: [
        { id: "Spaces", label: "Spaces", hint: "Indent with spaces" },
        { id: "Tabs", label: "Tabs", hint: null },
      ],
      acceptsText: true,
    });
  });

  it("records the answer against the question's own request", () => {
    const codex = opened("Ask me about indentation.");

    codex.mapper.openQuestions([ask]);
    codex.mapper.resolveRequest("req_1:q1", {
      kind: "answered",
      optionId: "Spaces",
      text: null,
    });

    expect(only(codex.events, "request.resolved")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "request.resolved",
      requestId: "req_1:q1",
      resolution: { kind: "answered", optionId: "Spaces", text: null },
    });
  });
});

describe("a turn Codex ends", () => {
  it("says nothing about an error it will retry", () => {
    const codex = opened("Say hello.");

    codex.mapper.applyNotification(
      notification("error", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        error: { message: "Reconnecting... 2/5" },
        willRetry: true,
      }),
    );

    expect(codex.events.map((event) => event.type)).toEqual([]);
  });

  it("spends the token usage it remembered on the completed turn", () => {
    const codex = opened("Say hello.");

    codex.mapper.applyNotification(
      notification("thread/tokenUsage/updated", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        tokenUsage: {
          last: {
            inputTokens: 12,
            cachedInputTokens: 4,
            cacheWriteInputTokens: 2,
            outputTokens: 7,
            reasoningOutputTokens: 3,
            totalTokens: 19,
          },
          total: {
            inputTokens: 12,
            cachedInputTokens: 4,
            cacheWriteInputTokens: 2,
            outputTokens: 7,
            reasoningOutputTokens: 3,
            totalTokens: 19,
          },
          modelContextWindow: 272_000,
        },
      }),
    );
    codex.mapper.applyNotification(
      notification("turn/completed", {
        threadId: THREAD_ID,
        turn: { id: CODEX_TURN_ID, status: "completed", error: null, durationMs: 2_530 },
      }),
    );

    expect(only(codex.events, "turn.completed")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      turnId: TURN_ID,
      type: "turn.completed",
      outcome: { kind: "completed" },
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        costUsd: null,
      },
      durationMs: 2_530,
    });
  });

  it("carries the message of the error it stopped on", () => {
    const codex = opened("Say hello.");

    codex.mapper.applyNotification(
      notification("error", {
        threadId: THREAD_ID,
        turnId: CODEX_TURN_ID,
        error: { message: "unexpected status 401 Unauthorized" },
        willRetry: false,
      }),
    );
    codex.mapper.applyNotification(
      notification("turn/completed", {
        threadId: THREAD_ID,
        turn: { id: CODEX_TURN_ID, status: "failed", error: null, durationMs: 11_000 },
      }),
    );

    expect(only(codex.events, "turn.completed").outcome).toEqual({
      kind: "failed",
      message: "unexpected status 401 Unauthorized",
    });
  });
});

describe("the thread Codex opens", () => {
  it("reports the thread id a resume would take, with the model", () => {
    const codex = opened("Say hello.");

    codex.mapper.applyNotification(
      notification("thread/started", {
        thread: { id: THREAD_ID, model: "gpt-6-astra", cwd: CWD, turns: [] },
      }),
    );

    expect(only(codex.events, "session.updated")).toEqual({
      id: "evt_1",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:01.000Z",
      type: "session.updated",
      changes: { nativeSessionId: THREAD_ID, model: "gpt-6-astra" },
    });
  });
});

describe("replaying the recorded handshake", () => {
  const RECORDING = join(import.meta.dirname, "fixtures", "handshake.jsonl");
  const RECORDED_THREAD = "01a0c9ef-dde7-7aa2-8f0b-d5f828b20e9b";
  const REFUSAL =
    "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: a3f2aaf4fd243b8e-YYZ, request id: req_c4f336472f6641d6bc015f67ecef350e";

  async function replay(): Promise<Driven> {
    const codex = opened("Create a file named hello.txt containing hello and stop.");
    for (const record of await readRecording(RECORDING)) {
      if (record.direction !== "in") {
        continue;
      }
      const frame = routeFrame(parseJson(record.line, AnyResult));
      if (frame !== null && frame.kind === "notification") {
        codex.mapper.applyNotification(frame);
      }
    }
    return codex;
  }

  it("emits the thread and the turn, and nothing for the retries between them", async () => {
    const codex = await replay();

    expect(codex.events.map((event) => event.type)).toEqual(["session.updated", "turn.completed"]);
  });

  it("fails the turn with the refusal and the duration Codex reported", async () => {
    const codex = await replay();

    expect(only(codex.events, "turn.completed")).toEqual({
      id: "evt_2",
      sessionId: SESSION_ID,
      at: "2026-09-22T15:23:02.000Z",
      turnId: TURN_ID,
      type: "turn.completed",
      outcome: { kind: "failed", message: REFUSAL },
      usage: null,
      durationMs: 14_222,
    });
  });

  it("reads the thread id a resume would take off the recording", async () => {
    const codex = await replay();

    expect(only(codex.events, "session.updated").changes).toEqual({
      nativeSessionId: RECORDED_THREAD,
      model: "gpt-6-astra",
    });
  });
});
