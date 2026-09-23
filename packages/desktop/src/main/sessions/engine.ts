import { randomUUID, type UUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import { errorMessage } from "@metabase/client/errors";

import type { SessionEnvironment } from "../../contracts/connection";
import type { MetabaseWorktree } from "../../contracts/metabase";
import {
  SessionEvent,
  type RewoundConversation,
  type SessionEventInput,
  type SyncOutcome,
  type TurnOutcome,
  type Workspace,
} from "../../contracts/events";
import { PROVIDER_LABELS, type ProviderKind } from "../../contracts/providers";
import { pendingRequests, projectSession } from "../../contracts/projector";
import {
  type ArchiveOutcome,
  type AnswerRequest,
  type CreateSessionRequest,
  type PinRequest,
  type Session,
  type SessionEventBatch,
  type SessionIndex,
  type SessionIndexEntry,
  type SessionOutcome,
  type SessionSnapshot,
  type TurnRequest,
} from "../../contracts/session";
import type { RewindRequest } from "../../contracts/changes";
import type { RepositorySnapshot } from "../../contracts/settings";
import type { CliLocation } from "../cli/paths";
import { captureCheckpoint, checkpointRef, deleteCheckpoints } from "../git/checkpoints";
import { listBranches, readCheckout, type Git } from "../git/service";
import { createWorktree, removeWorktree } from "../git/worktrees";
import type { MergedPath } from "../process/path";
import type { StartProcess } from "../process/spawn";
import type { ProviderAdapter, ProviderExit } from "../providers/adapter";
import type { ProviderDetector } from "../providers/detect";
import { openProviderLog } from "../providers/log";
import { repoRelative } from "../providers/text";

import { sessionBrief, systemAppend } from "./brief";
import { restoreCheckout } from "./changes";
import { sessionProcessEnvironment } from "./environment";
import { SessionCommandError } from "./errors";
import { LiveSession } from "./live";
import {
  branchName,
  branchSlug,
  MESSAGE_ID_PREFIX,
  promptIdOf,
  sessionTitle,
  slugOfBranch,
  uniqueSlug,
} from "./naming";
import { rewindPoint, replayedConversation, type RewindPoint } from "./rewind";
import { runSetupScript } from "./setup";
import type { SessionStore } from "./store";

const SESSION_ID_PREFIX = "ses_";
const TURN_ID_PREFIX = "trn_";
const EVENT_ID_PREFIX = "evt_";
const CALL_ID_PREFIX = "call_";

const CHECKPOINT_LABEL = "Capture checkpoint";
const BASELINE_CHECKPOINT_SEQ = 0;

const STOPPED_MID_TOOL_MESSAGE = "Stopped before this finished.";

const NO_REPOSITORY_MESSAGE = "Pick a repository in Settings first.";

const NO_DEFAULT_BRANCH_MESSAGE =
  "This repository names no default branch, so a worktree has nothing to branch from. Name a base branch.";

export interface EngineDeps {
  readonly store: SessionStore;
  readonly adapters: Readonly<Record<ProviderKind, ProviderAdapter>>;
  readonly providers: ProviderDetector;
  readonly git: Git;
  readonly repository: () => RepositorySnapshot | null;
  readonly worktreeRoot: () => string;
  readonly mintBrokerSession: (session: Session) => SessionEnvironment | null;
  readonly revokeBrokerSession: (brokerSessionId: string) => void;
  readonly worktree: (session: Session) => Promise<MetabaseWorktree>;
  readonly removeMetabaseWorktree: (
    session: Session,
    otherBranches: ReadonlySet<string>,
  ) => Promise<void>;
  readonly path: () => Promise<MergedPath>;
  readonly cli: CliLocation;
  readonly providerLogDirectory: string;
  readonly publish: (batch: SessionEventBatch) => void;
  readonly startProcess: StartProcess;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => Date;
  readonly log: (message: string) => void;
  readonly signal: AbortSignal;
}

interface WorkspaceResolved {
  readonly kind: "resolved";
  readonly workspace: Workspace;
  readonly setupNote: string | null;
}

interface WorkspaceRefused {
  readonly kind: "refused";
  readonly message: string;
}

type WorkspaceOutcome = WorkspaceResolved | WorkspaceRefused;

interface OpenWorkEnding {
  readonly outcome: TurnOutcome;
  readonly toolOutput: string;
}

interface OpenedTurn {
  readonly turnId: string;
  readonly messageId: string;
  readonly promptId: UUID;
}

export class SessionEngine {
  private readonly live = new Map<string, LiveSession>();

  constructor(private readonly deps: EngineDeps) {}

  index(): SessionIndex {
    return this.deps.store.index();
  }

  async create(request: CreateSessionRequest): Promise<SessionOutcome> {
    const repository = this.deps.repository();
    if (repository === null) {
      return { kind: "refused", message: NO_REPOSITORY_MESSAGE };
    }
    const binaryPath = await this.readyBinary(request.provider);
    if (binaryPath === null) {
      return {
        kind: "refused",
        message: `${PROVIDER_LABELS[request.provider]} is not ready to take a session. Rescan the agents in Settings.`,
      };
    }
    const workspace = await this.resolveWorkspace(request, repository);
    if (workspace.kind === "refused") {
      return workspace;
    }

    const sessionId = `${SESSION_ID_PREFIX}${randomUUID()}`;
    const title = sessionTitle(request.text);
    const at = this.stamp();
    const entry: SessionIndexEntry = {
      id: sessionId,
      title,
      provider: request.provider,
      workspace: workspace.workspace,
      lifecycle: "active",
      pinned: false,
      createdAt: at,
      updatedAt: at,
    };
    await this.deps.store.record(entry);

    const created = SessionEvent.parse({
      type: "session.created",
      id: this.eventId(),
      sessionId,
      seq: 0,
      at,
      title,
      provider: request.provider,
      model: request.model,
      workspace: workspace.workspace,
      permissionMode: request.permissionMode,
    });
    const live = new LiveSession({
      snapshot: projectSession([created]),
      store: this.deps.store,
      publish: this.deps.publish,
      onFailure: (message) => {
        this.deps.log(`session ${sessionId}: ${message}`);
      },
    });
    this.live.set(sessionId, live);
    await live.persist([created]);

    const baseline = await captureCheckpoint({
      git: this.deps.git,
      cwd: workspace.workspace.path,
      sessionId,
      seq: BASELINE_CHECKPOINT_SEQ,
      previousRef: null,
    });
    if (baseline.kind === "failed") {
      this.deps.log(`session ${sessionId}: the baseline checkpoint failed: ${baseline.message}`);
    }

    const turn = await this.openTurn(live, request.text, request.attachments);
    await this.runSetup(live, workspace.workspace, turn.turnId, workspace.setupNote);
    await this.startTurn(live, binaryPath, request.text, request.attachments, turn);
    return { kind: "opened", snapshot: live.snapshot };
  }

  async open(sessionId: string): Promise<SessionSnapshot> {
    const live = await this.load(sessionId);
    return live.snapshot;
  }

  async sendTurn(request: TurnRequest): Promise<void> {
    const live = await this.load(request.sessionId);
    if (live.snapshot.session.activity.kind === "running") {
      throw new SessionCommandError("This session is already working on a turn.");
    }
    const binaryPath = await this.readyBinary(live.snapshot.session.provider);
    if (binaryPath === null) {
      throw new SessionCommandError(
        `${PROVIDER_LABELS[live.snapshot.session.provider]} is not ready to take a turn.`,
      );
    }
    const turn = await this.openTurn(live, request.text, request.attachments);
    await this.startTurn(live, binaryPath, request.text, request.attachments, turn);
  }

  async answer(request: AnswerRequest): Promise<void> {
    const live = await this.load(request.sessionId);
    const open = pendingRequests(live.snapshot).find(
      (candidate) => candidate.requestId === request.requestId,
    );
    if (open === undefined) {
      throw new SessionCommandError(`Request ${request.requestId} is no longer waiting.`);
    }
    await live.answer({
      requestId: request.requestId,
      optionId: request.optionId,
      text: request.text,
    });
  }

  async interrupt(sessionId: string): Promise<void> {
    const live = await this.load(sessionId);
    await live.interrupt();
  }

  async stop(sessionId: string): Promise<void> {
    const live = await this.load(sessionId);
    await this.release(live);
  }

  async archive(sessionId: string): Promise<ArchiveOutcome> {
    const live = await this.load(sessionId);
    await this.release(live);
    const worktree = await this.disposeWorktree(live.snapshot);
    const entry = this.deps.store.entry(sessionId);
    if (entry === null) {
      throw new SessionCommandError(`Session ${sessionId} is not in the session list.`);
    }
    const index = await this.deps.store.record({ ...entry, lifecycle: "archived" });
    this.live.delete(sessionId);
    return { index, worktree };
  }

  async setPinned(request: PinRequest): Promise<SessionIndex> {
    if (this.deps.store.entry(request.sessionId) === null) {
      throw new SessionCommandError(`Session ${request.sessionId} is not in the session list.`);
    }
    return this.deps.store.setPinned(request.sessionId, request.pinned);
  }

  async remove(sessionId: string): Promise<SessionIndex> {
    const live = await this.load(sessionId);
    await this.release(live);
    await this.deps.removeMetabaseWorktree(live.snapshot.session, this.otherBranches(sessionId));
    await this.disposeWorktree(live.snapshot);
    const repository = this.deps.repository();
    if (repository !== null) {
      await deleteCheckpoints(this.deps.git, repository.path, sessionId);
    }
    this.live.delete(sessionId);
    return this.deps.store.forget(sessionId);
  }

  async rewind(request: RewindRequest): Promise<SessionSnapshot> {
    const live = await this.load(request.sessionId);
    const snapshot = live.snapshot;
    const session = snapshot.session;
    if (session.activity.kind === "running") {
      throw new SessionCommandError(
        "Stop the turn that is running before editing an earlier prompt.",
      );
    }
    const point = rewindPoint(snapshot, request.turnId);
    if (point === null) {
      throw new SessionCommandError(`Turn ${request.turnId} has no prompt in this session.`);
    }
    if (request.restoreFiles) {
      await restoreCheckout(this.deps.git, session.workspace, session.id, point.checkpointRef);
    }
    await this.release(live);
    const conversation = await this.rewindConversation(snapshot, point);
    const seq = live.nextCheckpointSeq();
    const checkpoint = await captureCheckpoint({
      git: this.deps.git,
      cwd: session.workspace.path,
      sessionId: session.id,
      seq,
      previousRef: checkpointRef(session.id, seq - 1),
    });
    if (checkpoint.kind === "failed") {
      throw new SessionCommandError(`The checkout could not be captured: ${checkpoint.message}`);
    }
    await live.emit({
      type: "session.rewound",
      id: this.eventId(),
      sessionId: session.id,
      at: this.stamp(),
      turnId: request.turnId,
      conversation,
      filesRestored: request.restoreFiles,
      checkpointRef: checkpoint.ref,
    });
    return live.snapshot;
  }

  async recordSync(sessionId: string, branch: string, outcome: SyncOutcome): Promise<void> {
    const live = await this.load(sessionId);
    await live.emit({
      type: "sync.completed",
      id: this.eventId(),
      sessionId,
      at: this.stamp(),
      branch,
      outcome,
    });
  }

  async shutdown(): Promise<void> {
    for (const live of this.live.values()) {
      await this.release(live);
    }
  }

  private async load(sessionId: string): Promise<LiveSession> {
    const existing = this.live.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    if (this.deps.store.entry(sessionId) === null) {
      throw new SessionCommandError(`Session ${sessionId} is not in the session list.`);
    }
    const events = await this.deps.store.readEvents(sessionId);
    const live = new LiveSession({
      snapshot: projectSession(events),
      store: this.deps.store,
      publish: this.deps.publish,
      onFailure: (message) => {
        this.deps.log(`session ${sessionId}: ${message}`);
      },
    });
    this.live.set(sessionId, live);
    await this.closeOpenWork(live, {
      outcome: { kind: "interrupted" },
      toolOutput: STOPPED_MID_TOOL_MESSAGE,
    });
    return live;
  }

  // Releasing drops the dead provider before the turn closes, so the turn the person sends next
  // starts a fresh one that resumes the conversation.
  private async closeAfterExit(live: LiveSession, exit: ProviderExit): Promise<void> {
    await this.release(live);
    const turnId = await this.closeOpenWork(live, {
      outcome: { kind: "failed", message: exit.turnMessage },
      toolOutput: exit.toolMessage,
    });
    if (turnId !== null) {
      await this.checkpoint(live, turnId);
    }
  }

  // A provider process that is gone, killed with the app or on its own, leaves the turn, its tools
  // and its requests open; closing them keeps the session from showing work that never ends.
  private async closeOpenWork(live: LiveSession, ending: OpenWorkEnding): Promise<string | null> {
    const closed: SessionEventInput[] = pendingRequests(live.snapshot).map((open) => ({
      type: "request.resolved",
      id: this.eventId(),
      sessionId: live.snapshot.session.id,
      at: this.stamp(),
      turnId: open.turnId,
      requestId: open.requestId,
      resolution: { kind: "expired" },
    }));
    for (const item of live.snapshot.items) {
      if (item.kind === "tool" && item.state.kind === "running") {
        closed.push({
          type: "tool.completed",
          id: this.eventId(),
          sessionId: live.snapshot.session.id,
          at: this.stamp(),
          turnId: item.turnId,
          callId: item.callId,
          status: "error",
          output: ending.toolOutput,
          files: [],
          patch: null,
        });
      }
    }
    const activity = live.snapshot.session.activity;
    if (activity.kind === "running") {
      closed.push({
        type: "turn.completed",
        id: this.eventId(),
        sessionId: live.snapshot.session.id,
        at: this.stamp(),
        turnId: activity.turnId,
        outcome: ending.outcome,
        usage: null,
        durationMs: Math.max(0, this.deps.now().getTime() - Date.parse(activity.startedAt)),
      });
    }
    for (const event of closed) {
      await live.emit(event);
    }
    return activity.kind === "running" ? activity.turnId : null;
  }

  private async readyBinary(kind: ProviderKind): Promise<string | null> {
    const health = await this.deps.providers.read();
    const found = health.find((candidate) => candidate.kind === kind);
    if (found === undefined || found.status !== "ready" || found.path === null) {
      return null;
    }
    return found.path;
  }

  private async resolveWorkspace(
    request: CreateSessionRequest,
    repository: RepositorySnapshot,
  ): Promise<WorkspaceOutcome> {
    if (request.workspace.kind === "in-place") {
      const checkout = await readCheckout(this.deps.git, repository.path);
      return {
        kind: "resolved",
        workspace: {
          kind: "in-place",
          path: repository.path,
          branch: checkout.branch,
          head: checkout.head,
        },
        setupNote: null,
      };
    }
    const base = request.workspace.base ?? repository.defaultBranch;
    if (base === null) {
      return { kind: "refused", message: NO_DEFAULT_BRANCH_MESSAGE };
    }
    const worktreeRoot = this.deps.worktreeRoot();
    const taken = await this.takenSlugs(repository.path, worktreeRoot);
    const slug = uniqueSlug(branchSlug(request.text), taken);
    const branch = branchName(slug);
    const created = await createWorktree({
      git: this.deps.git,
      root: repository.path,
      worktreeRoot,
      slug,
      branch,
      base,
    });
    if (created.kind === "refused") {
      return created;
    }
    return {
      kind: "resolved",
      workspace: { kind: "worktree", path: created.path, branch, base },
      setupNote: created.fetchMessage,
    };
  }

  private async takenSlugs(root: string, worktreeRoot: string): Promise<ReadonlySet<string>> {
    const taken = new Set<string>();
    for (const branch of await listBranches(this.deps.git, root)) {
      const slug = slugOfBranch(branch);
      if (slug !== null) {
        taken.add(slug);
      }
    }
    try {
      for (const entry of await readdir(worktreeRoot)) {
        taken.add(entry);
      }
    } catch (error) {
      this.deps.log(`worktree root ${worktreeRoot} is not readable yet: ${errorMessage(error)}`);
    }
    return taken;
  }

  private async rewindConversation(
    snapshot: SessionSnapshot,
    point: RewindPoint,
  ): Promise<RewoundConversation> {
    const session = snapshot.session;
    const promptId = promptIdOf(point.messageId);
    if (session.nativeSessionId === null || promptId === null) {
      return replayedConversation(point.kept);
    }
    const outcome = await this.deps.adapters[session.provider].rewind({
      nativeSessionId: session.nativeSessionId,
      cwd: session.workspace.path,
      promptId,
    });
    if (outcome.kind === "unsupported") {
      this.deps.log(
        `session ${session.id}: rewinding fell back to a new conversation: ${outcome.reason}`,
      );
      return replayedConversation(point.kept);
    }
    return outcome;
  }

  private async openTurn(
    live: LiveSession,
    text: string,
    attachments: readonly string[],
  ): Promise<OpenedTurn> {
    const turnId = `${TURN_ID_PREFIX}${randomUUID()}`;
    const promptId = randomUUID();
    const messageId = `${MESSAGE_ID_PREFIX}${promptId}`;
    const sessionId = live.snapshot.session.id;
    await live.emit({
      type: "turn.started",
      id: this.eventId(),
      sessionId,
      at: this.stamp(),
      turnId,
      userMessageId: messageId,
    });
    await live.emit({
      type: "user.message",
      id: this.eventId(),
      sessionId,
      at: this.stamp(),
      turnId,
      messageId,
      text,
      attachments: attachments.map((path) =>
        repoRelative(live.snapshot.session.workspace.path, path),
      ),
    });
    return { turnId, messageId, promptId };
  }

  private async startTurn(
    live: LiveSession,
    binaryPath: string,
    text: string,
    attachments: readonly string[],
    turn: OpenedTurn,
  ): Promise<void> {
    const started = await this.ensureProvider(live, binaryPath);
    if (!started) {
      return;
    }
    await live.sendTurn({
      turnId: turn.turnId,
      messageId: turn.messageId,
      promptId: turn.promptId,
      text,
      attachments: [...attachments],
    });
  }

  private async ensureProvider(live: LiveSession, binaryPath: string): Promise<boolean> {
    if (live.hasProvider()) {
      return true;
    }
    const session = live.snapshot.session;
    const broker = this.deps.mintBrokerSession(session);
    const env = await sessionProcessEnvironment(this.deps, session, broker);
    const log = await openProviderLog({
      directory: this.deps.providerLogDirectory,
      sessionId: session.id,
      secrets: broker === null ? [] : [broker.MB_AUTH_BROKER_TOKEN],
    });
    try {
      await live.start(this.deps.adapters[session.provider], {
        sessionId: session.id,
        binaryPath,
        cwd: session.workspace.path,
        model: session.model,
        permissionMode: session.permissionMode,
        resume: session.nativeSessionId,
        env,
        systemAppend: systemAppend(
          sessionBrief(session.workspace),
          session.nativeSessionId === null ? session.replay : null,
        ),
        extraArgs: [],
        clock: { now: () => this.stamp(), eventId: () => this.eventId() },
        log,
        signal: this.deps.signal,
      });
    } catch (error) {
      await log.close();
      if (broker !== null) {
        this.deps.revokeBrokerSession(broker.sessionId);
      }
      await live.emit({
        type: "session.failed",
        id: this.eventId(),
        sessionId: session.id,
        at: this.stamp(),
        reason: `${PROVIDER_LABELS[session.provider]} did not start.`,
        providerError: errorMessage(error),
      });
      return false;
    }
    live.holdResources(log, broker === null ? null : broker.sessionId);
    live.onTurnCompleted((turnId) => {
      void this.checkpoint(live, turnId);
    });
    live.onProviderExited((exit) => {
      void this.closeAfterExit(live, exit);
    });
    return true;
  }

  private async runSetup(
    live: LiveSession,
    workspace: Workspace,
    turnId: string,
    note: string | null,
  ): Promise<void> {
    const repository = this.deps.repository();
    if (repository === null) {
      return;
    }
    await runSetupScript({
      repositoryRoot: repository.path,
      cwd: workspace.path,
      note,
      env: this.deps.env,
      startProcess: this.deps.startProcess,
      emit: (event) => live.emit(event),
      sessionId: live.snapshot.session.id,
      turnId,
      callId: `${CALL_ID_PREFIX}${randomUUID()}`,
      eventId: () => this.eventId(),
      now: () => this.stamp(),
    });
  }

  // Capturing runs after the turn is recorded, so the timeline's working row ends with the provider
  // and the checkpoint row appears when it lands.
  private async checkpoint(live: LiveSession, turnId: string): Promise<void> {
    const session = live.snapshot.session;
    const seq = live.nextCheckpointSeq();
    const outcome = await captureCheckpoint({
      git: this.deps.git,
      cwd: session.workspace.path,
      sessionId: session.id,
      seq,
      previousRef: checkpointRef(session.id, seq - 1),
    });
    if (outcome.kind === "failed") {
      const callId = `${CALL_ID_PREFIX}${randomUUID()}`;
      await live.emit({
        type: "tool.started",
        id: this.eventId(),
        sessionId: session.id,
        at: this.stamp(),
        turnId,
        callId,
        tool: "command",
        label: CHECKPOINT_LABEL,
        input: { seq },
      });
      await live.emit({
        type: "tool.completed",
        id: this.eventId(),
        sessionId: session.id,
        at: this.stamp(),
        turnId,
        callId,
        status: "error",
        output: outcome.message,
        files: [],
        patch: null,
      });
      return;
    }
    await live.emit({
      type: "checkpoint.captured",
      id: this.eventId(),
      sessionId: session.id,
      at: this.stamp(),
      turnId,
      ref: outcome.ref,
      files: [...outcome.files],
    });
  }

  private async release(live: LiveSession): Promise<void> {
    const brokerSessionId = await live.stop();
    if (brokerSessionId !== null) {
      this.deps.revokeBrokerSession(brokerSessionId);
    }
  }

  private async disposeWorktree(snapshot: SessionSnapshot): Promise<ArchiveOutcome["worktree"]> {
    const workspace = snapshot.session.workspace;
    if (workspace.kind === "in-place") {
      return { kind: "absent" };
    }
    const repository = this.deps.repository();
    if (repository === null) {
      return { kind: "kept", reason: NO_REPOSITORY_MESSAGE };
    }
    const sharedWith = this.deps.store
      .index()
      .sessions.filter(
        (candidate) =>
          candidate.id !== snapshot.session.id &&
          candidate.lifecycle === "active" &&
          candidate.workspace.path === workspace.path,
      ).length;
    return removeWorktree({
      git: this.deps.git,
      root: repository.path,
      path: workspace.path,
      branch: workspace.branch,
      base: workspace.base,
      sharedWith,
    });
  }

  private otherBranches(sessionId: string): ReadonlySet<string> {
    const branches = this.deps.store
      .index()
      .sessions.filter((candidate) => candidate.id !== sessionId)
      .map((candidate) => candidate.workspace.branch)
      .filter((branch) => branch !== null);
    return new Set(branches);
  }

  private stamp(): string {
    return this.deps.now().toISOString();
  }

  private eventId(): string {
    return `${EVENT_ID_PREFIX}${randomUUID()}`;
  }
}
