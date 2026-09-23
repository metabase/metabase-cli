import { basename } from "node:path";

import { errorMessage } from "@metabase/client/errors";

import type { PermissionMode } from "../../../contracts/events";
import { startProcess, type ProcessExit, type RunningProcess } from "../../process/spawn";
import type {
  AnswerInput,
  ProviderExit,
  ProviderSession,
  SessionSink,
  StartSessionInput,
  TurnInput,
} from "../adapter";
import type { ProviderLog } from "../log";

import { PendingAsks } from "./asks";
import { CodexClient, CodexProtocolError, type CodexHandlers } from "./client";
import { CodexMessageMapper } from "./messages";
import {
  AnyResult,
  CODEX_ARGS,
  CODEX_METHOD,
  InitializeResult,
  THREAD_MODES,
  ThreadResult,
  ThreadScoped,
  ThreadStartedNotification,
  TurnResult,
  TurnStartedNotification,
  type CodexNotification,
  type CodexRequest,
} from "./protocol";
import {
  APPROVAL_METHOD,
  USER_INPUT_METHOD,
  shapeApproval,
  shapeQuestions,
  type ApprovalKind,
} from "./requests";

const CLIENT_NAME = "rde";
const CLIENT_TITLE = "Metabase RDE";
const CLIENT_VERSION = "0.0.0";
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;
const INTERNAL_ERROR = -32_603;
const UNKNOWN_METHOD_MESSAGE = "This client answers no such request.";
const UNREADABLE_PARAMS_MESSAGE = "This client could not read the request's parameters.";
const NO_TURN_MESSAGE = "This client has no turn in flight.";
const NO_THREAD_MESSAGE = "The Codex thread was never opened, so this turn cannot be sent.";
const EXITED_NOTE = "the Codex app server exited: ";
const CODEX_EXIT: ProviderExit = {
  turnMessage:
    "Codex stopped in the middle of this turn. Send a message to carry on; the conversation picks up where it stopped.",
  toolMessage: "Codex stopped before this finished.",
};
const RESUME_FALLBACK_NOTE = "thread/resume was refused; starting a fresh thread\n";
const UNKNOWN_SIGNAL = "an unknown signal";
const THREAD_MARKER = "thread";
const TURN_STARTED = "turn/started";
const TURN_COMPLETED = "turn/completed";
const RESUME_REFUSED_MARKERS: readonly string[] = [
  "not found",
  "missing thread",
  "no such thread",
  "unknown thread",
  "does not exist",
  "no rollout found",
];

interface ClientInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

interface InitializeParams {
  readonly clientInfo: ClientInfo;
}

export interface ThreadOptions {
  readonly cwd: string;
  readonly model: string | null;
  readonly permissionMode: PermissionMode;
  readonly systemAppend: string | null;
}

export interface ThreadParams {
  readonly cwd: string;
  readonly approvalPolicy: string;
  readonly sandbox: string;
  readonly approvalsReviewer: string;
  readonly model?: string;
  readonly developerInstructions?: string;
}

interface TextInput {
  readonly type: "text";
  readonly text: string;
}

interface MentionInput {
  readonly type: "mention";
  readonly name: string;
  readonly path: string;
}

type TurnInputItem = TextInput | MentionInput;

export function threadParams(options: ThreadOptions): ThreadParams {
  const mode = THREAD_MODES[options.permissionMode];
  return {
    cwd: options.cwd,
    approvalPolicy: mode.approvalPolicy,
    sandbox: mode.sandbox,
    approvalsReviewer: mode.approvalsReviewer,
    ...(options.model === null ? {} : { model: options.model }),
    ...(options.systemAppend === null ? {} : { developerInstructions: options.systemAppend }),
  };
}

export function initializeParams(): InitializeParams {
  return { clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version: CLIENT_VERSION } };
}

function turnItems(input: TurnInput): TurnInputItem[] {
  const text: TextInput = { type: "text", text: input.text };
  const mentions: MentionInput[] = input.attachments.map((path) => ({
    type: "mention",
    name: basename(path),
    path,
  }));
  return [text, ...mentions];
}

function refusedTheResume(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  if (!message.includes(THREAD_MARKER)) {
    return false;
  }
  return RESUME_REFUSED_MARKERS.some((marker) => message.includes(marker));
}

function exitReason(exit: ProcessExit): string {
  if (exit.kind === "failed") {
    return exit.message;
  }
  if (exit.code === null) {
    return `Codex was terminated by ${exit.signal ?? UNKNOWN_SIGNAL}`;
  }
  return `Codex exited with code ${exit.code}`;
}

class CodexSession implements ProviderSession {
  private readonly mapper: CodexMessageMapper;
  private readonly client: CodexClient;
  private readonly asks: PendingAsks;
  private readonly child: RunningProcess;
  private readonly log: ProviderLog;
  private readonly sink: SessionSink;

  private threadId: string | null = null;
  private turnId: string | null = null;
  private lastError: string | null = null;
  private nextRequest = 1;
  private stopped = false;

  constructor(input: StartSessionInput, sink: SessionSink, child: RunningProcess) {
    this.child = child;
    this.log = input.log;
    this.sink = sink;
    this.mapper = new CodexMessageMapper({
      sessionId: input.sessionId,
      cwd: input.cwd,
      clock: input.clock,
      sink,
    });
    const handlers: CodexHandlers = {
      onNotification: (notification) => {
        this.onNotification(notification);
      },
      onRequest: (request) => {
        this.onRequest(request);
      },
      onProtocolError: (error) => {
        this.log.write(`${error.message}\n`);
      },
      onStderr: (message) => {
        this.lastError = message;
      },
    };
    this.client = new CodexClient({
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      log: input.log,
      handlers,
    });
    this.asks = new PendingAsks(this.client);
    void child.exited.then((exit) => {
      this.onExit(exit);
    });
    if (input.signal.aborted) {
      void this.stop();
      return;
    }
    input.signal.addEventListener("abort", () => {
      void this.stop();
    });
  }

  get nativeSessionId(): string | null {
    return this.threadId;
  }

  async open(input: StartSessionInput): Promise<void> {
    await this.client.request(CODEX_METHOD.initialize, initializeParams(), InitializeResult);
    this.client.notify(CODEX_METHOD.initialized);
    this.threadId = await this.openThread(input);
  }

  async sendTurn(input: TurnInput): Promise<void> {
    const threadId = this.threadId;
    if (threadId === null) {
      throw new CodexProtocolError(NO_THREAD_MESSAGE);
    }
    this.mapper.beginTurn(input);
    const started = await this.client.request(
      CODEX_METHOD.turnStart,
      { threadId, input: turnItems(input) },
      TurnResult,
    );
    if (this.turnId === null) {
      this.turnId = started.turn.id;
    }
  }

  async answer(input: AnswerInput): Promise<void> {
    if (!this.asks.answer(input.requestId, input.optionId, input.text)) {
      throw new CodexProtocolError(`Codex has no open request "${input.requestId}"`);
    }
    this.mapper.resolveRequest(input.requestId, {
      kind: "answered",
      optionId: input.optionId,
      text: input.text,
    });
  }

  // Codex answers a server request on its own read loop, so an open ask blocks every inbound
  // message, the interrupt's own response included; the asks are settled before the RPC is sent.
  async interrupt(): Promise<void> {
    this.settleOpenAsks();
    const threadId = this.threadId;
    const turnId = this.turnId;
    if (threadId === null || turnId === null) {
      return;
    }
    await this.client.request(CODEX_METHOD.turnInterrupt, { threadId, turnId }, AnyResult);
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.settleOpenAsks();
    this.client.close();
    await this.child.stop();
    await this.log.close();
  }

  private async openThread(input: StartSessionInput): Promise<string> {
    const params = threadParams({
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      systemAppend: input.systemAppend,
    });
    const resume = input.resume;
    if (resume !== null) {
      try {
        const resumed = await this.client.request(
          CODEX_METHOD.threadResume,
          { ...params, threadId: resume },
          ThreadResult,
        );
        return resumed.thread.id;
      } catch (error) {
        if (!refusedTheResume(error)) {
          throw error;
        }
        this.log.write(RESUME_FALLBACK_NOTE);
      }
    }
    const started = await this.client.request(CODEX_METHOD.threadStart, params, ThreadResult);
    return started.thread.id;
  }

  // Codex accepts a turn while one is running and answers with the queued turn's id, but it only
  // interrupts the turn that is active now, which is the one its notification announced.
  private onNotification(notification: CodexNotification): void {
    if (!this.belongsToThread(notification)) {
      return;
    }
    if (notification.method === TURN_STARTED) {
      const started = TurnStartedNotification.safeParse(notification.params);
      if (started.success) {
        this.turnId = started.data.turn.id;
      }
    }
    this.mapper.applyNotification(notification);
    if (notification.method === TURN_COMPLETED) {
      this.turnId = null;
    }
  }

  // Codex runs threads of its own beside the user's; their notifications are not this session's.
  private belongsToThread(notification: CodexNotification): boolean {
    const threadId = this.threadId;
    if (threadId === null) {
      return true;
    }
    const scoped = ThreadScoped.safeParse(notification.params);
    if (scoped.success) {
      return scoped.data.threadId === threadId;
    }
    const started = ThreadStartedNotification.safeParse(notification.params);
    if (started.success) {
      return started.data.thread.id === threadId;
    }
    return true;
  }

  private onRequest(request: CodexRequest): void {
    switch (request.method) {
      case APPROVAL_METHOD.command: {
        this.openApproval(request, "command");
        return;
      }
      case APPROVAL_METHOD.fileChange: {
        this.openApproval(request, "fileChange");
        return;
      }
      case APPROVAL_METHOD.permissions: {
        this.openApproval(request, "permissions");
        return;
      }
      case USER_INPUT_METHOD: {
        this.openQuestions(request);
        return;
      }
      default: {
        this.client.refuseRequest(request.id, METHOD_NOT_FOUND, UNKNOWN_METHOD_MESSAGE);
        return;
      }
    }
  }

  private openApproval(request: CodexRequest, kind: ApprovalKind): void {
    const shaped = shapeApproval(kind, this.mintRequestId(), request.params);
    if (shaped === null) {
      this.client.refuseRequest(request.id, INVALID_PARAMS, UNREADABLE_PARAMS_MESSAGE);
      return;
    }
    if (!this.mapper.openApproval(shaped.ask)) {
      this.client.refuseRequest(request.id, INTERNAL_ERROR, NO_TURN_MESSAGE);
      return;
    }
    this.asks.openApproval(shaped.ask.requestId, request.id, shaped.grant);
  }

  private openQuestions(request: CodexRequest): void {
    const asks = shapeQuestions(this.mintRequestId(), request.params);
    if (asks === null) {
      this.client.refuseRequest(request.id, INVALID_PARAMS, UNREADABLE_PARAMS_MESSAGE);
      return;
    }
    if (!this.mapper.openQuestions(asks)) {
      this.client.refuseRequest(request.id, INTERNAL_ERROR, NO_TURN_MESSAGE);
      return;
    }
    this.asks.openQuestions(asks, request.id);
  }

  private settleOpenAsks(): void {
    for (const requestId of this.asks.cancelAll()) {
      this.mapper.resolveRequest(requestId, { kind: "expired" });
    }
  }

  private mintRequestId(): string {
    return `req_${this.nextRequest++}`;
  }

  private onExit(exit: ProcessExit): void {
    this.client.close();
    if (this.stopped) {
      return;
    }
    const reported = this.lastError ?? exitReason(exit);
    this.log.write(`${EXITED_NOTE}${reported}\n`);
    this.sink.exited(CODEX_EXIT);
  }
}

export async function startCodexSession(
  input: StartSessionInput,
  sink: SessionSink,
): Promise<ProviderSession> {
  const child = startProcess({
    command: input.binaryPath,
    args: [...CODEX_ARGS, ...input.extraArgs],
    env: input.env,
    cwd: input.cwd,
  });
  if (child.kind === "start-failed") {
    throw new CodexProtocolError(`Codex could not be started: ${child.message}`);
  }
  const session = new CodexSession(input, sink, child);
  try {
    await session.open(input);
  } catch (error) {
    await session.stop();
    throw error;
  }
  return session;
}
