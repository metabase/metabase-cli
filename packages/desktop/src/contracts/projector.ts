import { assertNever } from "./assert-never";
import type { SessionChanges, SessionEvent, TextChunk, ToolProgress } from "./events";
import { PROVIDER_LABELS } from "./providers";
import type { Session, SessionSnapshot, TimelineItem } from "./session";

export class SessionLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionLogError";
  }
}

export interface PendingRequest {
  readonly requestId: string;
  readonly turnId: string;
  readonly prompt: string;
  readonly options: readonly RequestChoice[];
  readonly acceptsText: boolean;
}

export interface RequestChoice {
  readonly id: string;
  readonly label: string;
  readonly hint: string | null;
}

type SessionCreated = Extract<SessionEvent, { type: "session.created" }>;

export function openingSnapshot(event: SessionCreated): SessionSnapshot {
  const session: Session = {
    id: event.sessionId,
    title: event.title,
    provider: event.provider,
    model: event.model,
    workspace: event.workspace,
    permissionMode: event.permissionMode,
    nativeSessionId: null,
    replay: null,
    lastCheckpointSeq: 0,
    slashCommands: [],
    activity: { kind: "idle" },
    createdAt: event.at,
    updatedAt: event.at,
  };
  return { session, items: [], lastSeq: event.seq };
}

export function projectSession(events: readonly SessionEvent[]): SessionSnapshot {
  const [first, ...rest] = events;
  if (first === undefined) {
    throw new SessionLogError("a session log is empty, so it names no session");
  }
  if (first.type !== "session.created") {
    throw new SessionLogError(`a session log opens on ${first.type}, not session.created`);
  }
  return rest.reduce(applyEvent, openingSnapshot(first));
}

export function applyEvent(snapshot: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  const next = project(snapshot, event);
  return {
    ...next,
    session: { ...next.session, updatedAt: event.at },
    lastSeq: event.seq,
  };
}

export function pendingRequests(snapshot: SessionSnapshot): readonly PendingRequest[] {
  const open: PendingRequest[] = [];
  for (const item of snapshot.items) {
    if (item.kind === "request" && item.resolution === null) {
      open.push({
        requestId: item.requestId,
        turnId: item.turnId,
        prompt: item.prompt,
        options: item.options,
        acceptsText: item.acceptsText,
      });
    }
  }
  return open;
}

function project(snapshot: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  switch (event.type) {
    case "session.created": {
      throw new SessionLogError(`session ${event.sessionId} was created twice`);
    }
    case "session.updated": {
      return withSession(snapshot, applyChanges(snapshot.session, event.changes));
    }
    case "session.failed": {
      return withSession(snapshot, {
        ...snapshot.session,
        activity: {
          kind: "failed",
          reason: event.reason,
          providerError: event.providerError,
        },
      });
    }
    case "session.rewound": {
      const kept = keptBefore(snapshot.items, event.turnId);
      const session: Session = {
        ...snapshot.session,
        nativeSessionId:
          event.conversation.kind === "forked" ? event.conversation.nativeSessionId : null,
        replay: event.conversation.kind === "replayed" ? event.conversation.replay : null,
        lastCheckpointSeq: snapshot.session.lastCheckpointSeq + 1,
      };
      return append(
        { ...snapshot, session, items: kept },
        { kind: "notice", id: event.id, at: event.at, text: rewindNotice(snapshot.session, event) },
      );
    }
    case "turn.started": {
      return withSession(snapshot, {
        ...snapshot.session,
        activity: { kind: "running", turnId: event.turnId, startedAt: event.at },
      });
    }
    case "turn.completed": {
      const ended = withSession(snapshot, { ...snapshot.session, activity: { kind: "idle" } });
      return append(ended, {
        kind: "turn",
        id: event.id,
        at: event.at,
        turnId: event.turnId,
        outcome: event.outcome,
        usage: event.usage,
        durationMs: event.durationMs,
      });
    }
    case "user.message": {
      return append(snapshot, {
        kind: "user",
        id: event.id,
        at: event.at,
        turnId: event.turnId,
        messageId: event.messageId,
        text: event.text,
        attachments: event.attachments,
      });
    }
    case "assistant.text": {
      return withText(snapshot, "assistant", event.id, event.at, event.turnId, {
        messageId: event.messageId,
        chunk: event.chunk,
      });
    }
    case "assistant.reasoning": {
      return withText(snapshot, "reasoning", event.id, event.at, event.turnId, {
        messageId: event.messageId,
        chunk: event.chunk,
      });
    }
    case "tool.started": {
      return append(snapshot, {
        kind: "tool",
        id: event.id,
        at: event.at,
        turnId: event.turnId,
        callId: event.callId,
        tool: event.tool,
        label: event.label,
        input: event.input,
        state: { kind: "running" },
        output: "",
        files: [],
        patch: null,
      });
    }
    case "tool.updated": {
      return replaceTool(snapshot, event.callId, (item) => advance(item, event.progress));
    }
    case "tool.completed": {
      // A tool that streamed its output reports none of its own at the end, and the lines already
      // on screen are the output; one that reports its output in full replaces what it streamed.
      return replaceTool(snapshot, event.callId, (item) => ({
        ...item,
        state: { kind: "finished", status: event.status },
        output: event.output.length === 0 ? item.output : event.output,
        files: event.files,
        patch: event.patch,
      }));
    }
    case "request.opened": {
      return append(snapshot, {
        kind: "request",
        id: event.id,
        at: event.at,
        turnId: event.turnId,
        requestId: event.requestId,
        request: event.kind,
        callId: event.callId,
        prompt: event.prompt,
        options: event.options,
        acceptsText: event.acceptsText,
        resolution: null,
      });
    }
    case "request.resolved": {
      return replaceRequest(snapshot, event.requestId, (item) => ({
        ...item,
        resolution: event.resolution,
      }));
    }
    case "checkpoint.captured": {
      const counted = withSession(snapshot, {
        ...snapshot.session,
        lastCheckpointSeq: snapshot.session.lastCheckpointSeq + 1,
      });
      return append(counted, {
        kind: "checkpoint",
        id: event.id,
        at: event.at,
        turnId: event.turnId,
        ref: event.ref,
        files: event.files,
      });
    }
    case "sync.completed": {
      return append(snapshot, {
        kind: "sync",
        id: event.id,
        at: event.at,
        branch: event.branch,
        outcome: event.outcome,
      });
    }
    case "context.compacted": {
      return append(snapshot, {
        kind: "notice",
        id: event.id,
        at: event.at,
        text: event.notice,
      });
    }
    default: {
      return assertNever(event);
    }
  }
}

type SessionRewound = Extract<SessionEvent, { type: "session.rewound" }>;

// Rows that belong to no turn go too, since they happened after the point the conversation
// returns to.
function keptBefore(items: readonly TimelineItem[], turnId: string): TimelineItem[] {
  const cut = items.findIndex((item) => "turnId" in item && item.turnId === turnId);
  return cut === -1 ? [...items] : items.slice(0, cut);
}

function rewindNotice(session: Session, event: SessionRewound): string {
  const files = event.filesRestored
    ? "The files are back to how they were before it."
    : "The files were left as they are.";
  const conversation =
    event.conversation.kind !== "replayed"
      ? ""
      : ` ${PROVIDER_LABELS[session.provider]} could not rewind its own conversation, so a new one starts with the transcript up to here.`;
  return `Edited from an earlier prompt. ${files}${conversation}`;
}

function withSession(snapshot: SessionSnapshot, session: Session): SessionSnapshot {
  return { ...snapshot, session };
}

// A key the update leaves out is a field it does not touch, which is why each one is read rather
// than spread: a spread would write `undefined` over a field the sender never mentioned.
function applyChanges(session: Session, changes: SessionChanges): Session {
  let next = session;
  if (changes.title !== undefined) {
    next = { ...next, title: changes.title };
  }
  if (changes.nativeSessionId !== undefined) {
    next = { ...next, nativeSessionId: changes.nativeSessionId };
  }
  if (changes.model !== undefined) {
    next = { ...next, model: changes.model };
  }
  if (changes.permissionMode !== undefined) {
    next = { ...next, permissionMode: changes.permissionMode };
  }
  if (changes.slashCommands !== undefined) {
    next = { ...next, slashCommands: changes.slashCommands };
  }
  return next;
}

function append(snapshot: SessionSnapshot, item: TimelineItem): SessionSnapshot {
  return { ...snapshot, items: [...snapshot.items, item] };
}

type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
type RequestItem = Extract<TimelineItem, { kind: "request" }>;
type TextItem = Extract<TimelineItem, { kind: "assistant" | "reasoning" }>;

interface TextUpdate {
  readonly messageId: string;
  readonly chunk: TextChunk;
}

function withText(
  snapshot: SessionSnapshot,
  kind: TextItem["kind"],
  id: string,
  at: string,
  turnId: string,
  update: TextUpdate,
): SessionSnapshot {
  const index = snapshot.items.findIndex(
    (item) => item.kind === kind && item.messageId === update.messageId,
  );
  const existing = snapshot.items[index];
  if (existing === undefined || existing.kind !== kind) {
    return append(snapshot, {
      kind,
      id,
      at,
      turnId,
      messageId: update.messageId,
      text: update.chunk.text,
    });
  }
  return replaceAt(snapshot, index, { ...existing, text: grow(existing.text, update.chunk) });
}

function grow(text: string, chunk: TextChunk): string {
  return chunk.kind === "delta" ? `${text}${chunk.text}` : chunk.text;
}

function advance(item: ToolItem, progress: ToolProgress): ToolItem {
  switch (progress.kind) {
    case "output": {
      return { ...item, output: `${item.output}${progress.text}` };
    }
    case "status": {
      return { ...item, label: progress.label };
    }
    case "patch": {
      return { ...item, patch: progress.patch };
    }
    default: {
      return assertNever(progress);
    }
  }
}

function replaceTool(
  snapshot: SessionSnapshot,
  callId: string,
  change: (item: ToolItem) => ToolItem,
): SessionSnapshot {
  const index = snapshot.items.findIndex((item) => item.kind === "tool" && item.callId === callId);
  const existing = snapshot.items[index];
  if (existing === undefined || existing.kind !== "tool") {
    throw new SessionLogError(`tool call ${callId} was reported before it started`);
  }
  return replaceAt(snapshot, index, change(existing));
}

function replaceRequest(
  snapshot: SessionSnapshot,
  requestId: string,
  change: (item: RequestItem) => RequestItem,
): SessionSnapshot {
  const index = snapshot.items.findIndex(
    (item) => item.kind === "request" && item.requestId === requestId,
  );
  const existing = snapshot.items[index];
  if (existing === undefined || existing.kind !== "request") {
    throw new SessionLogError(`request ${requestId} was resolved before it opened`);
  }
  return replaceAt(snapshot, index, change(existing));
}

function replaceAt(snapshot: SessionSnapshot, index: number, item: TimelineItem): SessionSnapshot {
  const items = [...snapshot.items];
  items[index] = item;
  return { ...snapshot, items };
}
