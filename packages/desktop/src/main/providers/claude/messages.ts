import type {
  RequestResolution,
  SessionChanges,
  SessionId,
  TurnId,
} from "../../../contracts/events";
import type { EventSink, SessionClock, TurnInput } from "../adapter";

import { QUESTION_TOOL_NAME, QuestionToolInput, type AskedQuestion } from "./questions";
import {
  permissionOptions,
  questionOptions,
  type OpenQuestion,
  type OpenedRequest,
  type PermissionRequest,
} from "./requests";
import {
  ASSISTANT_MESSAGE,
  AssistantMessage,
  CompactBoundaryMessage,
  InitMessage,
  MessageStartEvent,
  QuestionResult,
  RESULT_MESSAGE,
  ResultMessage,
  STREAM_MESSAGE,
  SYSTEM_MESSAGE,
  StreamMessage,
  TextBlock,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolResultBlock,
  ToolUseBlock,
  ToolUseResult,
  USER_MESSAGE,
  UserToolMessage,
  appPermissionMode,
  toolKindOf,
  toolLabel,
  toolErrorText,
  toolResultText,
  turnOutcome,
  turnUsage,
  unifiedPatch,
  type ClaudeMessage,
} from "./wire";
import { repoRelative } from "../text";

export interface ClaudeMapperOptions {
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly clock: SessionClock;
  readonly sink: EventSink;
}

interface EventScope {
  readonly id: string;
  readonly sessionId: SessionId;
  readonly at: string;
}

interface TurnScope extends EventScope {
  readonly turnId: TurnId;
}

export class ClaudeMessageMapper {
  private readonly sessionId: SessionId;
  private readonly cwd: string;
  private readonly clock: SessionClock;
  private readonly sink: EventSink;

  private native: string | null = null;
  private turn: TurnId | null = null;
  private streamMessageId: string | null = null;
  private readonly questions = new Map<string, OpenQuestion>();
  private readonly settled = new Set<string>();

  constructor(options: ClaudeMapperOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.clock = options.clock;
    this.sink = options.sink;
  }

  get nativeSessionId(): string | null {
    return this.native;
  }

  get activeTurn(): TurnId | null {
    return this.turn;
  }

  beginTurn(input: TurnInput): void {
    this.turn = input.turnId;
    this.streamMessageId = null;
    this.forgetRequests();
  }

  forgetNativeSession(): void {
    this.native = null;
    this.sink.emit({
      ...this.scope(),
      type: "session.updated",
      changes: { nativeSessionId: null },
    });
  }

  resolveRequest(requestId: string, resolution: RequestResolution): void {
    const turnId = this.turn;
    if (turnId === null || this.settled.has(requestId)) {
      return;
    }
    this.settled.add(requestId);
    this.sink.emit({ ...this.turnScope(turnId), type: "request.resolved", requestId, resolution });
  }

  applyMessage(message: ClaudeMessage): void {
    switch (message.type) {
      case SYSTEM_MESSAGE: {
        this.onSystem(message);
        return;
      }
      case STREAM_MESSAGE: {
        this.onStream(message);
        return;
      }
      case ASSISTANT_MESSAGE: {
        this.onAssistant(message);
        return;
      }
      case USER_MESSAGE: {
        this.onUser(message);
        return;
      }
      case RESULT_MESSAGE: {
        this.onResult(message);
        return;
      }
      default: {
        return;
      }
    }
  }

  applyPermission(
    request: PermissionRequest,
    registerBeforeAnnouncing: (opened: OpenedRequest) => void,
  ): OpenedRequest | null {
    const turnId = this.turn;
    if (turnId === null) {
      return null;
    }
    const asked = QuestionToolInput.safeParse(request.input);
    const opened: OpenedRequest =
      request.toolName === QUESTION_TOOL_NAME && asked.success
        ? { kind: "question", requestId: request.requestId, question: asked.data.questions[0] }
        : { kind: "permission", requestId: request.requestId };
    registerBeforeAnnouncing(opened);
    if (opened.kind === "question") {
      this.openQuestion(turnId, request, opened.question);
      return opened;
    }
    this.openPermission(turnId, request);
    return opened;
  }

  private openQuestion(turnId: TurnId, request: PermissionRequest, question: AskedQuestion): void {
    this.questions.set(request.toolUseId, {
      requestId: request.requestId,
      questionText: question.question,
    });
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "request.opened",
      requestId: request.requestId,
      kind: "question",
      callId: null,
      prompt: question.question,
      options: questionOptions(question),
      acceptsText: true,
    });
  }

  private openPermission(turnId: TurnId, request: PermissionRequest): void {
    const label = toolLabel(request.toolName, request.input, this.cwd);
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "request.opened",
      requestId: request.requestId,
      kind: "permission",
      callId: request.toolUseId,
      prompt: request.title ?? `${label}?`,
      options: permissionOptions(request.hasSuggestions),
      acceptsText: false,
    });
  }

  private onSystem(message: ClaudeMessage): void {
    const init = InitMessage.safeParse(message);
    if (init.success) {
      this.onInit(init.data);
      return;
    }
    const compacted = CompactBoundaryMessage.safeParse(message);
    if (compacted.success) {
      this.onCompacted(compacted.data);
    }
  }

  private onInit(message: InitMessage): void {
    this.native = message.session_id;
    const mode = appPermissionMode(message.permissionMode);
    const changes: SessionChanges = {
      nativeSessionId: message.session_id,
      model: message.model,
      slashCommands: message.slash_commands,
      ...(mode === null ? {} : { permissionMode: mode }),
    };
    this.sink.emit({ ...this.scope(), type: "session.updated", changes });
  }

  private onCompacted(message: CompactBoundaryMessage): void {
    const turnId = this.turn;
    if (turnId === null) {
      return;
    }
    const { trigger, pre_tokens } = message.compact_metadata;
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "context.compacted",
      notice: `Context compacted (${trigger}) from ${pre_tokens} tokens.`,
    });
  }

  private onStream(message: ClaudeMessage): void {
    const stream = StreamMessage.safeParse(message);
    if (!stream.success) {
      return;
    }
    const event = stream.data.event;
    const started = MessageStartEvent.safeParse(event);
    if (started.success) {
      this.streamMessageId = started.data.message.id;
      return;
    }
    const messageId = this.streamMessageId;
    const turnId = this.turn;
    if (messageId === null || turnId === null) {
      return;
    }
    const text = TextDeltaEvent.safeParse(event);
    if (text.success) {
      this.sink.emit({
        ...this.turnScope(turnId),
        type: "assistant.text",
        messageId,
        chunk: { kind: "delta", text: text.data.delta.text },
      });
      return;
    }
    const thinking = ThinkingDeltaEvent.safeParse(event);
    if (thinking.success) {
      this.sink.emit({
        ...this.turnScope(turnId),
        type: "assistant.reasoning",
        messageId,
        chunk: { kind: "delta", text: thinking.data.delta.thinking },
      });
    }
  }

  private onAssistant(message: ClaudeMessage): void {
    const assistant = AssistantMessage.safeParse(message);
    const turnId = this.turn;
    if (!assistant.success || turnId === null) {
      return;
    }
    const messageId = assistant.data.message.id;
    for (const block of assistant.data.message.content) {
      const text = TextBlock.safeParse(block);
      if (text.success) {
        this.sink.emit({
          ...this.turnScope(turnId),
          type: "assistant.text",
          messageId,
          chunk: { kind: "complete", text: text.data.text },
        });
        continue;
      }
      const call = ToolUseBlock.safeParse(block);
      if (call.success) {
        this.onToolUse(turnId, call.data);
      }
    }
  }

  private onToolUse(turnId: TurnId, block: ToolUseBlock): void {
    if (block.name === QUESTION_TOOL_NAME) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "tool.started",
      callId: block.id,
      tool: toolKindOf(block.name),
      label: toolLabel(block.name, block.input, this.cwd),
      input: block.input,
    });
  }

  private onUser(message: ClaudeMessage): void {
    const user = UserToolMessage.safeParse(message);
    const turnId = this.turn;
    if (!user.success || turnId === null) {
      return;
    }
    for (const block of user.data.message.content) {
      const result = ToolResultBlock.safeParse(block);
      if (result.success) {
        this.onToolResult(turnId, result.data, user.data.tool_use_result);
      }
    }
  }

  private onToolResult(turnId: TurnId, block: ToolResultBlock, toolUseResult: unknown): void {
    const question = this.questions.get(block.tool_use_id);
    if (question !== undefined) {
      this.onQuestionAnswered(block.tool_use_id, question, toolUseResult);
      return;
    }
    const touched = ToolUseResult.safeParse(toolUseResult);
    const filePath = touched.success ? touched.data.filePath : undefined;
    const hunks = touched.success ? touched.data.structuredPatch : undefined;
    const failed = block.is_error === true;
    const text = toolResultText(block.content);
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "tool.completed",
      callId: block.tool_use_id,
      status: failed ? "error" : "ok",
      output: failed ? toolErrorText(text) : text,
      files: filePath === undefined ? [] : [repoRelative(this.cwd, filePath)],
      patch: hunks === undefined ? null : unifiedPatch(hunks),
    });
  }

  private onQuestionAnswered(callId: string, question: OpenQuestion, result: unknown): void {
    this.questions.delete(callId);
    const answered = QuestionResult.safeParse(result);
    const chosen = answered.success ? answered.data.answers[question.questionText] : undefined;
    this.resolveRequest(
      question.requestId,
      chosen === undefined
        ? { kind: "dismissed" }
        : { kind: "answered", optionId: chosen, text: null },
    );
  }

  private onResult(message: ClaudeMessage): void {
    const result = ResultMessage.safeParse(message);
    const turnId = this.turn;
    if (!result.success || turnId === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(turnId),
      type: "turn.completed",
      outcome: turnOutcome(result.data),
      usage: turnUsage(result.data),
      durationMs: result.data.duration_ms,
    });
    this.turn = null;
    this.streamMessageId = null;
    this.forgetRequests();
  }

  private forgetRequests(): void {
    this.questions.clear();
    this.settled.clear();
  }

  private scope(): EventScope {
    return { id: this.clock.eventId(), sessionId: this.sessionId, at: this.clock.now() };
  }

  private turnScope(turnId: TurnId): TurnScope {
    return { ...this.scope(), turnId };
  }
}
