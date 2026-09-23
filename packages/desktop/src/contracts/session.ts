import { z } from "zod";

import {
  ChangedFile,
  SessionEvent,
  PermissionMode,
  RequestKind,
  RequestOption,
  RequestResolution,
  SyncOutcome,
  ToolKind,
  ToolStatus,
  TurnOutcome,
  TurnUsage,
  Workspace,
} from "./events";
import { ProviderKind } from "./providers";

const ActivityIdle = z.object({ kind: z.literal("idle") }).strict();

const ActivityRunning = z
  .object({
    kind: z.literal("running"),
    turnId: z.string().min(1),
    startedAt: z.iso.datetime(),
  })
  .strict();

const ActivityFailed = z
  .object({
    kind: z.literal("failed"),
    reason: z.string().min(1),
    providerError: z.string().min(1).nullable(),
  })
  .strict();

export const SessionActivity = z.discriminatedUnion("kind", [
  ActivityIdle,
  ActivityRunning,
  ActivityFailed,
]);
export type SessionActivity = z.infer<typeof SessionActivity>;

// `model` is null only for a session logged before every session named its model. `replay` is the
// transcript a fresh provider conversation starts from after an edit the provider could not rewind.
// `lastCheckpointSeq` still counts the checkpoints of turns an edit dropped, so a new checkpoint
// never reuses a sequence number whose ref is already written.
export const Session = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    provider: ProviderKind,
    model: z.string().min(1).nullable(),
    workspace: Workspace,
    permissionMode: PermissionMode,
    nativeSessionId: z.string().min(1).nullable(),
    replay: z.string().min(1).nullable(),
    lastCheckpointSeq: z.number().int().nonnegative(),
    slashCommands: z.array(z.string().min(1)),
    activity: SessionActivity,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Session = z.infer<typeof Session>;

const ITEM_SCOPE = { id: z.string().min(1), at: z.iso.datetime() };

const TURN_ITEM_SCOPE = { ...ITEM_SCOPE, turnId: z.string().min(1) };

const UserItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("user"),
    messageId: z.string().min(1),
    text: z.string(),
    attachments: z.array(z.string().min(1)),
  })
  .strict();

const AssistantItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("assistant"),
    messageId: z.string().min(1),
    text: z.string(),
  })
  .strict();

const ReasoningItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("reasoning"),
    messageId: z.string().min(1),
    text: z.string(),
  })
  .strict();

const ToolRunning = z.object({ kind: z.literal("running") }).strict();

const ToolFinished = z.object({ kind: z.literal("finished"), status: ToolStatus }).strict();

export const ToolState = z.discriminatedUnion("kind", [ToolRunning, ToolFinished]);
export type ToolState = z.infer<typeof ToolState>;

const ToolItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("tool"),
    callId: z.string().min(1),
    tool: ToolKind,
    label: z.string().min(1),
    input: z.json(),
    state: ToolState,
    output: z.string(),
    files: z.array(z.string().min(1)),
    patch: z.string().nullable(),
  })
  .strict();

// `resolution` is null while the request is still waiting on the user.
const RequestItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("request"),
    requestId: z.string().min(1),
    request: RequestKind,
    callId: z.string().min(1).nullable(),
    prompt: z.string().min(1),
    options: z.array(RequestOption).min(1),
    acceptsText: z.boolean(),
    resolution: RequestResolution.nullable(),
  })
  .strict();

const CheckpointItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("checkpoint"),
    ref: z.string().min(1),
    files: z.array(ChangedFile),
  })
  .strict();

const TurnItem = z
  .object({
    ...TURN_ITEM_SCOPE,
    kind: z.literal("turn"),
    outcome: TurnOutcome,
    usage: TurnUsage.nullable(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

const SyncItem = z
  .object({
    ...ITEM_SCOPE,
    kind: z.literal("sync"),
    branch: z.string().min(1),
    outcome: SyncOutcome,
  })
  .strict();

const NoticeItem = z
  .object({ ...ITEM_SCOPE, kind: z.literal("notice"), text: z.string().min(1) })
  .strict();

export const TimelineItem = z.discriminatedUnion("kind", [
  UserItem,
  AssistantItem,
  ReasoningItem,
  ToolItem,
  RequestItem,
  CheckpointItem,
  TurnItem,
  SyncItem,
  NoticeItem,
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export type TimelineItemKind = TimelineItem["kind"];

export const SessionSnapshot = z
  .object({
    session: Session,
    items: z.array(TimelineItem),
    lastSeq: z.number().int().nonnegative(),
  })
  .strict();
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

export const SESSION_STORE_VERSION = 2;

export const SessionLifecycle = z.enum(["active", "archived"]);
export type SessionLifecycle = z.infer<typeof SessionLifecycle>;

export const SessionIndexEntry = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    provider: ProviderKind,
    workspace: Workspace,
    lifecycle: SessionLifecycle,
    pinned: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type SessionIndexEntry = z.infer<typeof SessionIndexEntry>;

export const SessionIndex = z
  .object({
    version: z.literal(SESSION_STORE_VERSION),
    sessions: z.array(SessionIndexEntry),
  })
  .strict();
export type SessionIndex = z.infer<typeof SessionIndex>;

const SessionIndexEntryV1 = SessionIndexEntry.omit({ pinned: true }).strict();
export type SessionIndexEntryV1 = z.infer<typeof SessionIndexEntryV1>;

export const SessionIndexV1 = z
  .object({ version: z.literal(1), sessions: z.array(SessionIndexEntryV1) })
  .strict();
export type SessionIndexV1 = z.infer<typeof SessionIndexV1>;

const WorkspaceRequestInPlace = z.object({ kind: z.literal("in-place") }).strict();

// `base` is null for the project's own default branch, which the app resolves when it creates the
// worktree rather than freezing a guess into the request.
const WorkspaceRequestWorktree = z
  .object({ kind: z.literal("worktree"), base: z.string().min(1).nullable() })
  .strict();

export const WorkspaceRequest = z.discriminatedUnion("kind", [
  WorkspaceRequestInPlace,
  WorkspaceRequestWorktree,
]);
export type WorkspaceRequest = z.infer<typeof WorkspaceRequest>;

export const CreateSessionRequest = z
  .object({
    provider: ProviderKind,
    model: z.string().min(1),
    permissionMode: PermissionMode,
    workspace: WorkspaceRequest,
    text: z.string().min(1),
    attachments: z.array(z.string().min(1)),
  })
  .strict();
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

const SessionOpened = z.object({ kind: z.literal("opened"), snapshot: SessionSnapshot }).strict();

const SessionRefused = z
  .object({ kind: z.literal("refused"), message: z.string().min(1) })
  .strict();

export const SessionOutcome = z.discriminatedUnion("kind", [SessionOpened, SessionRefused]);
export type SessionOutcome = z.infer<typeof SessionOutcome>;

export const SessionEventBatch = z
  .object({ sessionId: z.string().min(1), events: z.array(SessionEvent) })
  .strict();
export type SessionEventBatch = z.infer<typeof SessionEventBatch>;

export const SessionRef = z.object({ sessionId: z.string().min(1) }).strict();
export type SessionRef = z.infer<typeof SessionRef>;

export const PinRequest = z.object({ sessionId: z.string().min(1), pinned: z.boolean() }).strict();
export type PinRequest = z.infer<typeof PinRequest>;

export const TurnRequest = z
  .object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    attachments: z.array(z.string().min(1)),
  })
  .strict();
export type TurnRequest = z.infer<typeof TurnRequest>;

export const AnswerRequest = z
  .object({
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    optionId: z.string().min(1),
    text: z.string().min(1).nullable(),
  })
  .strict();
export type AnswerRequest = z.infer<typeof AnswerRequest>;

const WorktreeRemoved = z.object({ kind: z.literal("removed") }).strict();

const WorktreeKept = z.object({ kind: z.literal("kept"), reason: z.string().min(1) }).strict();

const WorktreeAbsent = z.object({ kind: z.literal("absent") }).strict();

export const WorktreeDisposition = z.discriminatedUnion("kind", [
  WorktreeRemoved,
  WorktreeKept,
  WorktreeAbsent,
]);
export type WorktreeDisposition = z.infer<typeof WorktreeDisposition>;

export const ArchiveOutcome = z
  .object({ index: SessionIndex, worktree: WorktreeDisposition })
  .strict();
export type ArchiveOutcome = z.infer<typeof ArchiveOutcome>;
