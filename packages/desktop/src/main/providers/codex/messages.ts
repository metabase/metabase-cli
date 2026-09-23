import type {
  RequestResolution,
  SessionChanges,
  SessionId,
  TurnId,
  TurnUsage,
} from "../../../contracts/events";
import type { EventSink, SessionClock, TurnInput } from "../adapter";

import {
  assistantChunkOf,
  changesPatch,
  compactionItemId,
  planItemId,
  planLabel,
  toolOutcomeOf,
  toolRowOf,
  type ToolRow,
} from "./items";
import {
  DeltaNotification,
  ErrorNotification,
  ItemNotification,
  PatchUpdatedNotification,
  PlanUpdatedNotification,
  ThreadStartedNotification,
  TokenUsageNotification,
  TurnCompletedNotification,
  addUsage,
  turnOutcomeOf,
  type CodexNotification,
} from "./protocol";
import { firstText } from "../text";
import {
  approvalOptions,
  approvalPrompt,
  questionOptions,
  type ApprovalAsk,
  type QuestionAsk,
} from "./requests";

const COMPACTED_NOTICE = "Codex compacted the conversation.";

export interface CodexMapperOptions {
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

interface ActiveTurn {
  readonly turnId: TurnId;
  readonly startedAtMs: number;
  usage: TurnUsage | null;
  failure: string | null;
  planCallId: string | null;
}

export class CodexMessageMapper {
  private readonly sessionId: SessionId;
  private readonly cwd: string;
  private readonly clock: SessionClock;
  private readonly sink: EventSink;

  private active: ActiveTurn | null = null;
  private readonly rows = new Map<string, ToolRow>();
  private readonly settled = new Set<string>();

  constructor(options: CodexMapperOptions) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.clock = options.clock;
    this.sink = options.sink;
  }

  get activeTurn(): TurnId | null {
    return this.active === null ? null : this.active.turnId;
  }

  beginTurn(input: TurnInput): void {
    this.active = {
      turnId: input.turnId,
      startedAtMs: Date.parse(this.clock.now()),
      usage: null,
      failure: null,
      planCallId: null,
    };
    this.rows.clear();
    this.settled.clear();
  }

  resolveRequest(requestId: string, resolution: RequestResolution): void {
    const active = this.active;
    if (active === null || this.settled.has(requestId)) {
      return;
    }
    this.settled.add(requestId);
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "request.resolved",
      requestId,
      resolution,
    });
  }

  openApproval(ask: ApprovalAsk): boolean {
    const active = this.active;
    if (active === null) {
      return false;
    }
    const row = this.rows.get(ask.itemId);
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "request.opened",
      requestId: ask.requestId,
      kind: "permission",
      callId: ask.itemId,
      prompt: approvalPrompt(ask.kind, firstText(row?.label, ask.detail)),
      options: approvalOptions(),
      acceptsText: false,
    });
    return true;
  }

  openQuestions(asks: readonly QuestionAsk[]): boolean {
    const active = this.active;
    if (active === null) {
      return false;
    }
    for (const ask of asks) {
      this.sink.emit({
        ...this.turnScope(active.turnId),
        type: "request.opened",
        requestId: ask.requestId,
        kind: "question",
        callId: ask.itemId,
        prompt: ask.question.question,
        options: questionOptions(ask.question),
        acceptsText: true,
      });
    }
    return true;
  }

  applyNotification(notification: CodexNotification): void {
    switch (notification.method) {
      case "thread/started": {
        this.onThreadStarted(notification.params);
        return;
      }
      case "item/started": {
        this.onItemStarted(notification.params);
        return;
      }
      case "item/completed": {
        this.onItemCompleted(notification.params);
        return;
      }
      case "item/agentMessage/delta": {
        this.onTextDelta(notification.params, false);
        return;
      }
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta": {
        this.onTextDelta(notification.params, true);
        return;
      }
      case "item/commandExecution/outputDelta": {
        this.onOutputDelta(notification.params);
        return;
      }
      case "item/fileChange/patchUpdated": {
        this.onPatchUpdated(notification.params);
        return;
      }
      case "turn/plan/updated": {
        this.onPlanUpdated(notification.params);
        return;
      }
      case "thread/compacted": {
        this.onCompacted();
        return;
      }
      case "thread/tokenUsage/updated": {
        this.onTokenUsage(notification.params);
        return;
      }
      case "error": {
        this.onError(notification.params);
        return;
      }
      case "turn/completed": {
        this.onTurnCompleted(notification.params);
        return;
      }
      default: {
        return;
      }
    }
  }

  private onThreadStarted(params: unknown): void {
    const parsed = ThreadStartedNotification.safeParse(params);
    if (!parsed.success) {
      return;
    }
    const { id, model } = parsed.data.thread;
    const changes: SessionChanges = {
      nativeSessionId: id,
      ...(model === undefined ? {} : { model }),
    };
    this.sink.emit({ ...this.scope(), type: "session.updated", changes });
  }

  private onItemStarted(params: unknown): void {
    const parsed = ItemNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    const row = toolRowOf(parsed.data.item, this.cwd);
    if (row === null) {
      return;
    }
    this.rows.set(row.callId, row);
    if (planItemId(parsed.data.item) !== null) {
      active.planCallId = row.callId;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "tool.started",
      callId: row.callId,
      tool: row.tool,
      label: row.label,
      input: parsed.data.item,
    });
  }

  private onItemCompleted(params: unknown): void {
    const parsed = ItemNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    const item = parsed.data.item;
    const chunk = assistantChunkOf(item);
    if (chunk !== null) {
      this.sink.emit({
        ...this.turnScope(active.turnId),
        type: chunk.reasoning ? "assistant.reasoning" : "assistant.text",
        messageId: chunk.messageId,
        chunk: { kind: "complete", text: chunk.text },
      });
      return;
    }
    if (compactionItemId(item) !== null) {
      this.onCompacted();
      return;
    }
    const row = toolRowOf(item, this.cwd);
    const outcome = toolOutcomeOf(item, this.cwd);
    if (row === null || outcome === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "tool.completed",
      callId: row.callId,
      status: outcome.status,
      output: outcome.output,
      files: outcome.files,
      patch: outcome.patch,
    });
  }

  private onTextDelta(params: unknown, reasoning: boolean): void {
    const parsed = DeltaNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: reasoning ? "assistant.reasoning" : "assistant.text",
      messageId: parsed.data.itemId,
      chunk: { kind: "delta", text: parsed.data.delta },
    });
  }

  private onOutputDelta(params: unknown): void {
    const parsed = DeltaNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "tool.updated",
      callId: parsed.data.itemId,
      progress: { kind: "output", text: parsed.data.delta },
    });
  }

  private onPatchUpdated(params: unknown): void {
    const parsed = PatchUpdatedNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    const patch = changesPatch(parsed.data.changes, this.cwd);
    if (patch === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "tool.updated",
      callId: parsed.data.itemId,
      progress: { kind: "patch", patch },
    });
  }

  private onPlanUpdated(params: unknown): void {
    const parsed = PlanUpdatedNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null || active.planCallId === null) {
      return;
    }
    const label = planLabel(parsed.data.plan);
    if (label === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "tool.updated",
      callId: active.planCallId,
      progress: { kind: "status", label },
    });
  }

  private onCompacted(): void {
    const active = this.active;
    if (active === null) {
      return;
    }
    this.sink.emit({
      ...this.turnScope(active.turnId),
      type: "context.compacted",
      notice: COMPACTED_NOTICE,
    });
  }

  private onTokenUsage(params: unknown): void {
    const parsed = TokenUsageNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    active.usage = addUsage(active.usage, parsed.data.tokenUsage.last);
  }

  private onError(params: unknown): void {
    const parsed = ErrorNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null || parsed.data.willRetry) {
      return;
    }
    active.failure = firstText(parsed.data.error.message);
  }

  private onTurnCompleted(params: unknown): void {
    const parsed = TurnCompletedNotification.safeParse(params);
    const active = this.active;
    if (!parsed.success || active === null) {
      return;
    }
    const scope = this.turnScope(active.turnId);
    const { status, error, durationMs } = parsed.data.turn;
    const reported = durationMs === null || durationMs === undefined ? null : durationMs;
    this.sink.emit({
      ...scope,
      type: "turn.completed",
      outcome: turnOutcomeOf(status, firstText(error?.message, active.failure)),
      usage: active.usage,
      durationMs: reported ?? Date.parse(scope.at) - active.startedAtMs,
    });
    this.active = null;
    this.rows.clear();
    this.settled.clear();
  }

  private scope(): EventScope {
    return { id: this.clock.eventId(), sessionId: this.sessionId, at: this.clock.now() };
  }

  private turnScope(turnId: TurnId): TurnScope {
    return { ...this.scope(), turnId };
  }
}
