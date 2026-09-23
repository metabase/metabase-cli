import { z } from "zod";

import { ContentLink } from "./metabase";
import { ProviderKind } from "./providers";

export type SessionId = string;
export type TurnId = string;
export type EventId = string;
export type MessageId = string;
export type ToolCallId = string;
export type RequestId = string;

// `auto-review` hands each ask to the agent's own reviewer; `bypass` runs every tool unchecked.
export const PermissionMode = z.enum(["ask", "edits", "auto-review", "bypass"]);
export type PermissionMode = z.infer<typeof PermissionMode>;

// Logs written before the agent's reviewer was offered spell `bypass` as `auto`.
const LoggedPermissionMode = z.union([
  PermissionMode,
  z.literal("auto").transform((): PermissionMode => "bypass"),
]);

// `branch` is null on a detached HEAD and `head` is null in a repository with no commit yet; both
// are states the checkout is really in rather than fields the app has failed to fill.
const WorkspaceInPlace = z
  .object({
    kind: z.literal("in-place"),
    path: z.string().min(1),
    branch: z.string().min(1).nullable(),
    head: z.string().min(1).nullable(),
  })
  .strict();

const WorkspaceWorktree = z
  .object({
    kind: z.literal("worktree"),
    path: z.string().min(1),
    branch: z.string().min(1),
    base: z.string().min(1),
  })
  .strict();

export const Workspace = z.discriminatedUnion("kind", [WorkspaceInPlace, WorkspaceWorktree]);
export type Workspace = z.infer<typeof Workspace>;

export const ToolKind = z.enum(["command", "read", "edit", "search", "web", "other"]);
export type ToolKind = z.infer<typeof ToolKind>;

export const ToolStatus = z.enum(["ok", "error"]);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const RequestKind = z.enum(["permission", "question"]);
export type RequestKind = z.infer<typeof RequestKind>;

const TextDelta = z.object({ kind: z.literal("delta"), text: z.string() }).strict();

const TextComplete = z.object({ kind: z.literal("complete"), text: z.string() }).strict();

export const TextChunk = z.discriminatedUnion("kind", [TextDelta, TextComplete]);
export type TextChunk = z.infer<typeof TextChunk>;

const ToolOutputProgress = z.object({ kind: z.literal("output"), text: z.string() }).strict();

const ToolStatusProgress = z
  .object({ kind: z.literal("status"), label: z.string().min(1) })
  .strict();

const ToolPatchProgress = z.object({ kind: z.literal("patch"), patch: z.string() }).strict();

export const ToolProgress = z.discriminatedUnion("kind", [
  ToolOutputProgress,
  ToolStatusProgress,
  ToolPatchProgress,
]);
export type ToolProgress = z.infer<typeof ToolProgress>;

export const RequestOption = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    hint: z.string().min(1).nullable(),
  })
  .strict();
export type RequestOption = z.infer<typeof RequestOption>;

const RequestAnswered = z
  .object({
    kind: z.literal("answered"),
    optionId: z.string().min(1),
    text: z.string().nullable(),
  })
  .strict();

const RequestDismissed = z.object({ kind: z.literal("dismissed") }).strict();

const RequestExpired = z.object({ kind: z.literal("expired") }).strict();

export const RequestResolution = z.discriminatedUnion("kind", [
  RequestAnswered,
  RequestDismissed,
  RequestExpired,
]);
export type RequestResolution = z.infer<typeof RequestResolution>;

const TurnCompleted = z.object({ kind: z.literal("completed") }).strict();

const TurnInterrupted = z.object({ kind: z.literal("interrupted") }).strict();

const TurnFailed = z.object({ kind: z.literal("failed"), message: z.string().min(1) }).strict();

export const TurnOutcome = z.discriminatedUnion("kind", [
  TurnCompleted,
  TurnInterrupted,
  TurnFailed,
]);
export type TurnOutcome = z.infer<typeof TurnOutcome>;

export const TurnUsage = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().nullable(),
  })
  .strict();
export type TurnUsage = z.infer<typeof TurnUsage>;

export const ChangedFile = z
  .object({
    path: z.string().min(1),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();
export type ChangedFile = z.infer<typeof ChangedFile>;

const SyncImported = z
  .object({ kind: z.literal("imported"), links: z.array(ContentLink) })
  .strict();

const SyncFailed = z.object({ kind: z.literal("failed"), message: z.string().min(1) }).strict();

export const SyncOutcome = z.discriminatedUnion("kind", [SyncImported, SyncFailed]);
export type SyncOutcome = z.infer<typeof SyncOutcome>;

// An absent key is a field this update leaves alone; `nativeSessionId: null` is a session that has none.
export const SessionChanges = z
  .object({
    title: z.string().min(1).optional(),
    nativeSessionId: z.string().min(1).nullable().optional(),
    model: z.string().min(1).optional(),
    permissionMode: LoggedPermissionMode.optional(),
    slashCommands: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SessionChanges = z.infer<typeof SessionChanges>;

const SESSION_SCOPE = {
  id: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
};

const TURN_SCOPE = { ...SESSION_SCOPE, turnId: z.string().min(1) };

const SessionCreated = z
  .object({
    ...SESSION_SCOPE,
    type: z.literal("session.created"),
    title: z.string().min(1),
    provider: ProviderKind,
    // Null only in logs written before every session named its model.
    model: z.string().min(1).nullable(),
    workspace: Workspace,
    permissionMode: LoggedPermissionMode,
  })
  .strict();

const SessionUpdated = z
  .object({
    ...SESSION_SCOPE,
    type: z.literal("session.updated"),
    changes: SessionChanges,
  })
  .strict();

const SessionFailed = z
  .object({
    ...SESSION_SCOPE,
    type: z.literal("session.failed"),
    reason: z.string().min(1),
    providerError: z.string().min(1).nullable(),
  })
  .strict();

const SyncCompleted = z
  .object({
    ...SESSION_SCOPE,
    type: z.literal("sync.completed"),
    branch: z.string().min(1),
    outcome: SyncOutcome,
  })
  .strict();

const TurnStarted = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("turn.started"),
    userMessageId: z.string().min(1),
  })
  .strict();

const TurnEnded = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("turn.completed"),
    outcome: TurnOutcome,
    usage: TurnUsage.nullable(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const UserMessage = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("user.message"),
    messageId: z.string().min(1),
    text: z.string(),
    attachments: z.array(z.string().min(1)),
  })
  .strict();

const AssistantText = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("assistant.text"),
    messageId: z.string().min(1),
    chunk: TextChunk,
  })
  .strict();

const AssistantReasoning = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("assistant.reasoning"),
    messageId: z.string().min(1),
    chunk: TextChunk,
  })
  .strict();

const ToolStarted = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("tool.started"),
    callId: z.string().min(1),
    tool: ToolKind,
    label: z.string().min(1),
    input: z.json(),
  })
  .strict();

const ToolUpdated = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("tool.updated"),
    callId: z.string().min(1),
    progress: ToolProgress,
  })
  .strict();

const ToolCompleted = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("tool.completed"),
    callId: z.string().min(1),
    status: ToolStatus,
    output: z.string(),
    files: z.array(z.string().min(1)),
    patch: z.string().nullable(),
  })
  .strict();

const RequestOpened = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("request.opened"),
    requestId: z.string().min(1),
    kind: RequestKind,
    callId: z.string().min(1).nullable(),
    prompt: z.string().min(1),
    options: z.array(RequestOption).min(1),
    acceptsText: z.boolean(),
  })
  .strict();

const RequestResolved = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("request.resolved"),
    requestId: z.string().min(1),
    resolution: RequestResolution,
  })
  .strict();

const CheckpointCaptured = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("checkpoint.captured"),
    ref: z.string().min(1),
    files: z.array(ChangedFile),
  })
  .strict();

const ConversationForked = z
  .object({ kind: z.literal("forked"), nativeSessionId: z.string().min(1) })
  .strict();

// The prompt opened the conversation, so there is nothing to keep and a new one starts empty.
const ConversationFresh = z.object({ kind: z.literal("fresh") }).strict();

// The provider could not cut its own conversation, so a new one is handed the transcript instead.
const ConversationReplayed = z
  .object({ kind: z.literal("replayed"), replay: z.string().min(1) })
  .strict();

export const RewoundConversation = z.discriminatedUnion("kind", [
  ConversationForked,
  ConversationFresh,
  ConversationReplayed,
]);
export type RewoundConversation = z.infer<typeof RewoundConversation>;

// Editing from a prompt drops that turn and every one after it. `checkpointRef` is the checkout
// captured at the rewind, which the next turn's diff starts from.
const SessionRewound = z
  .object({
    ...SESSION_SCOPE,
    type: z.literal("session.rewound"),
    turnId: z.string().min(1),
    conversation: RewoundConversation,
    filesRestored: z.boolean(),
    checkpointRef: z.string().min(1),
  })
  .strict();

const ContextCompacted = z
  .object({
    ...TURN_SCOPE,
    type: z.literal("context.compacted"),
    notice: z.string().min(1),
  })
  .strict();

export const SessionEvent = z.discriminatedUnion("type", [
  SessionCreated,
  SessionUpdated,
  SessionFailed,
  SessionRewound,
  SyncCompleted,
  TurnStarted,
  TurnEnded,
  UserMessage,
  AssistantText,
  AssistantReasoning,
  ToolStarted,
  ToolUpdated,
  ToolCompleted,
  RequestOpened,
  RequestResolved,
  CheckpointCaptured,
  ContextCompacted,
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

export type SessionEventType = SessionEvent["type"];

export const SESSION_EVENT_TYPES: readonly SessionEventType[] = SessionEvent.options.map(
  (option) => option.shape.type.value,
);

type WithoutSequence<Event> = Event extends unknown ? Omit<Event, "seq"> : never;

export type SessionEventInput = WithoutSequence<SessionEvent>;
