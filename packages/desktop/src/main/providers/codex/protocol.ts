import { z } from "zod";

import { assertNever } from "../../../contracts/assert-never";
import type { PermissionMode, TurnOutcome, TurnUsage } from "../../../contracts/events";

export const CODEX_ARGS = ["app-server"] as const;

export const CODEX_METHOD = {
  initialize: "initialize",
  initialized: "initialized",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
  modelList: "model/list",
} as const;

// `auto_review` hands an approval to Codex's own reviewing agent instead of the person.
interface ThreadMode {
  readonly approvalPolicy: string;
  readonly approvalsReviewer: "user" | "auto_review";
  readonly sandbox: string;
}

export const THREAD_MODES: Readonly<Record<PermissionMode, ThreadMode>> = {
  ask: { approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only" },
  edits: { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" },
  "auto-review": {
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandbox: "workspace-write",
  },
  bypass: { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" },
};

const TURN_FAILED_WITHOUT_REASON = "The Codex turn failed without a reason.";

const NO_TOKENS: TurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

export const JsonRpcId = z.union([z.number(), z.string()]);
export type JsonRpcId = z.infer<typeof JsonRpcId>;

const JsonRpcErrorBody = z.object({ code: z.number().int(), message: z.string() }).loose();
export type JsonRpcErrorBody = z.infer<typeof JsonRpcErrorBody>;

const RequestFrame = z
  .object({ id: JsonRpcId, method: z.string().min(1), params: z.json().optional() })
  .loose();

const NotificationFrame = z
  .object({ method: z.string().min(1), id: z.undefined().optional(), params: z.json().optional() })
  .loose();

const FailureFrame = z.object({ id: JsonRpcId, error: JsonRpcErrorBody }).loose();

const ResultFrame = z.object({ id: JsonRpcId, result: z.json() }).loose();

export interface CodexRequest {
  readonly kind: "request";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: unknown;
}

export interface CodexNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params: unknown;
}

export interface CodexResult {
  readonly kind: "result";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface CodexFailure {
  readonly kind: "failure";
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorBody;
}

export type CodexFrame = CodexRequest | CodexNotification | CodexResult | CodexFailure;

export function routeFrame(value: unknown): CodexFrame | null {
  const request = RequestFrame.safeParse(value);
  if (request.success) {
    return {
      kind: "request",
      id: request.data.id,
      method: request.data.method,
      params: request.data.params,
    };
  }
  const notification = NotificationFrame.safeParse(value);
  if (notification.success) {
    return {
      kind: "notification",
      method: notification.data.method,
      params: notification.data.params,
    };
  }
  const failure = FailureFrame.safeParse(value);
  if (failure.success) {
    return { kind: "failure", id: failure.data.id, error: failure.data.error };
  }
  const result = ResultFrame.safeParse(value);
  if (result.success) {
    return { kind: "result", id: result.data.id, result: result.data.result };
  }
  return null;
}

export const InitializeResult = z.object({ userAgent: z.string().min(1) }).loose();

export const ThreadResult = z
  .object({ thread: z.object({ id: z.string().min(1) }).loose() })
  .loose();

export const TurnResult = z.object({ turn: z.object({ id: z.string().min(1) }).loose() }).loose();

export const AnyResult = z.unknown();

const ListedModel = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    hidden: z.boolean(),
    isDefault: z.boolean(),
  })
  .loose();

export const ModelListResult = z.object({ data: z.array(ListedModel) }).loose();
export type ModelListResult = z.infer<typeof ModelListResult>;

export const ThreadStartedNotification = z
  .object({
    thread: z.object({ id: z.string().min(1), model: z.string().min(1).optional() }).loose(),
  })
  .loose();

const TurnStatus = z.enum(["completed", "interrupted", "failed", "inProgress"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

const TurnError = z.object({ message: z.string() }).loose();

export const TurnStartedNotification = z
  .object({ turn: z.object({ id: z.string().min(1) }).loose() })
  .loose();

export const TurnCompletedNotification = z
  .object({
    turn: z
      .object({
        id: z.string().min(1),
        status: TurnStatus,
        error: TurnError.nullish(),
        durationMs: z.number().int().nonnegative().nullish(),
      })
      .loose(),
  })
  .loose();

export const ItemNotification = z.object({ item: z.json() }).loose();

export const DeltaNotification = z.object({ itemId: z.string().min(1), delta: z.string() }).loose();

export const FileUpdateChange = z.object({ path: z.string().min(1), diff: z.string() }).loose();
export type FileUpdateChange = z.infer<typeof FileUpdateChange>;

export const PatchUpdatedNotification = z
  .object({ itemId: z.string().min(1), changes: z.array(FileUpdateChange) })
  .loose();

const PlanStep = z
  .object({ step: z.string().min(1), status: z.enum(["pending", "inProgress", "completed"]) })
  .loose();
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanUpdatedNotification = z.object({ plan: z.array(PlanStep) }).loose();

const TokenBreakdown = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative(),
  })
  .loose();
export type TokenBreakdown = z.infer<typeof TokenBreakdown>;

export const TokenUsageNotification = z
  .object({ tokenUsage: z.object({ last: TokenBreakdown }).loose() })
  .loose();

export const ErrorNotification = z.object({ error: TurnError, willRetry: z.boolean() }).loose();

export function turnOutcomeOf(status: TurnStatus, message: string | null): TurnOutcome {
  switch (status) {
    case "completed": {
      return { kind: "completed" };
    }
    case "interrupted": {
      return { kind: "interrupted" };
    }
    case "failed":
    case "inProgress": {
      return { kind: "failed", message: message ?? TURN_FAILED_WITHOUT_REASON };
    }
    default: {
      return assertNever(status);
    }
  }
}

// Codex reports the thread's running total and `last`, the newest model response. Within a turn the
// total grows by exactly `last`, so summing `last` is the turn's own usage. The cache-write counter
// is absent when nothing was written.
export function addUsage(previous: TurnUsage | null, breakdown: TokenBreakdown): TurnUsage {
  const base = previous ?? NO_TOKENS;
  return {
    inputTokens: base.inputTokens + breakdown.inputTokens,
    outputTokens: base.outputTokens + breakdown.outputTokens,
    cacheReadTokens: base.cacheReadTokens + breakdown.cachedInputTokens,
    cacheWriteTokens: base.cacheWriteTokens + (breakdown.cacheWriteInputTokens ?? 0),
    costUsd: null,
  };
}

export const ThreadScoped = z.object({ threadId: z.string().min(1) }).loose();
