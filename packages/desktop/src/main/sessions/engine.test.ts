import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pollUntil } from "@metabase/client/poll";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionEvent } from "../../contracts/events";
import type { ProviderKind } from "../../contracts/providers";
import type { RepositorySnapshot } from "../../contracts/settings";
import { cliLocation } from "../cli/paths";
import { checkpointRef } from "../git/checkpoints";
import { Git, gitText } from "../git/service";
import type { MergedPath } from "../process/path";
import { runCommand, startProcess } from "../process/spawn";
import type {
  ProviderAdapter,
  ProviderExit,
  ProviderSession,
  SessionSink,
  StartSessionInput,
  TurnInput,
} from "../providers/adapter";
import { ProviderDetector } from "../providers/detect";

import { SessionEngine } from "./engine";
import { SessionStore } from "./store";

const NEVER_ABORTED = new AbortController().signal;
const AT = "2026-09-23T12:00:00.000Z";
const FIRST_PROMPT = "Clean the orders table";
const FOLLOW_UP = "Say done and stop.";
const NATIVE_SESSION_ID = "native-conversation";
const CALL_ID = "toolu_read";
const REQUEST_ID = "req_write";
const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 5_000;

const FAKE_EXIT: ProviderExit = {
  turnMessage: "The fake agent stopped in the middle of this turn.",
  toolMessage: "The fake agent stopped before this finished.",
};

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "RDE Test",
  GIT_AUTHOR_EMAIL: "rde-test@example.com",
  GIT_COMMITTER_NAME: "RDE Test",
  GIT_COMMITTER_EMAIL: "rde-test@example.com",
};

const git = new Git({ env: GIT_ENV, run: runCommand, start: startProcess, signal: NEVER_ABORTED });

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});

async function emptyPath(): Promise<MergedPath> {
  return { entries: [], value: "", loginShell: { kind: "read", shell: "/bin/sh" } };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

class FakeProvider implements ProviderSession {
  readonly turns: TurnInput[] = [];
  stopped = false;

  constructor(
    readonly input: StartSessionInput,
    readonly sink: SessionSink,
  ) {}

  get nativeSessionId(): string | null {
    return NATIVE_SESSION_ID;
  }

  sendTurn(input: TurnInput): Promise<void> {
    this.turns.push(input);
    return Promise.resolve();
  }

  answer(): Promise<void> {
    return Promise.resolve();
  }

  interrupt(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  // What a provider maps from its stream before it dies: its conversation id, then a tool it
  // starts and a permission it asks for, both left open.
  startWork(turnId: string): void {
    const scope = { sessionId: this.input.sessionId, at: this.input.clock.now() };
    this.sink.emit({
      ...scope,
      id: this.input.clock.eventId(),
      type: "session.updated",
      changes: { nativeSessionId: NATIVE_SESSION_ID },
    });
    this.sink.emit({
      ...scope,
      id: this.input.clock.eventId(),
      type: "tool.started",
      turnId,
      callId: CALL_ID,
      tool: "read",
      label: "Read orders.yaml",
      input: { file_path: "orders.yaml" },
    });
    this.sink.emit({
      ...scope,
      id: this.input.clock.eventId(),
      type: "request.opened",
      turnId,
      requestId: REQUEST_ID,
      kind: "permission",
      callId: CALL_ID,
      prompt: "Write orders.yaml?",
      options: [{ id: "allow", label: "Allow once", hint: null }],
      acceptsText: false,
    });
  }
}

interface Harness {
  readonly engine: SessionEngine;
  readonly store: SessionStore;
  readonly started: FakeProvider[];
}

function fakeAdapter(kind: ProviderKind, started: FakeProvider[]): ProviderAdapter {
  return {
    kind,
    binaryName: kind,
    fallbackModels: {
      models: [{ id: "opus", label: "Opus", resolvedId: null }],
      defaultModel: "opus",
    },
    listModels: async () => null,
    probe: async () => ({ status: "ready", account: null, message: null }),
    start: async (input, sink) => {
      const provider = new FakeProvider(input, sink);
      started.push(provider);
      return provider;
    },
    rewind: async () => ({ kind: "unsupported", reason: "the fake agent keeps no history" }),
  };
}

async function harness(): Promise<Harness> {
  const root = await temporaryDirectory("rde-engine-repo-");
  await gitText(await git.write(root, ["init", "--quiet", "--initial-branch=main"]));
  await writeFile(join(root, "orders.yaml"), "name: orders\n", "utf8");
  await gitText(await git.write(root, ["add", "."]));
  await gitText(await git.write(root, ["commit", "--quiet", "-m", "seed"]));
  const userData = await temporaryDirectory("rde-engine-data-");
  const repository: RepositorySnapshot = {
    path: root,
    remote: null,
    defaultBranch: "main",
    layout: "other",
  };
  const started: FakeProvider[] = [];
  const adapters = { claude: fakeAdapter("claude", started), codex: fakeAdapter("codex", started) };
  const providers = new ProviderDetector({
    probes: adapters,
    preferences: () => ({
      claude: { enabled: true, binaryPath: process.execPath },
      codex: { enabled: true, binaryPath: process.execPath },
    }),
    path: emptyPath,
    env: process.env,
    run: runCommand,
    now: Date.now,
    platform: process.platform,
    signal: NEVER_ABORTED,
  });
  const store = await SessionStore.open(userData);
  const engine = new SessionEngine({
    store,
    adapters,
    providers,
    git,
    repository: () => repository,
    worktreeRoot: () => join(userData, "worktrees"),
    mintBrokerSession: () => null,
    revokeBrokerSession: () => undefined,
    worktreeEnvironment: async () => ({}),
    removeMetabaseWorktree: async () => undefined,
    path: emptyPath,
    cli: cliLocation({ kind: "dev", outDir: join(userData, "out") }, process.execPath),
    providerLogDirectory: join(userData, "logs"),
    publish: () => undefined,
    startProcess,
    env: GIT_ENV,
    now: () => new Date(AT),
    log: () => undefined,
    signal: NEVER_ABORTED,
  });
  return { engine, store, started };
}

interface DiedMidTurn {
  readonly sessionId: string;
  readonly turnId: string;
  readonly provider: FakeProvider;
  readonly lastSeqBeforeExit: number;
}

async function dieMidTurn(setup: Harness): Promise<DiedMidTurn> {
  const outcome = await setup.engine.create({
    provider: "claude",
    model: "opus",
    permissionMode: "ask",
    workspace: { kind: "in-place" },
    text: FIRST_PROMPT,
    attachments: [],
  });
  if (outcome.kind !== "opened") {
    throw new Error(`the session did not open: ${outcome.message}`);
  }
  const [provider] = setup.started;
  const [turn] = provider === undefined ? [] : provider.turns;
  if (provider === undefined || turn === undefined) {
    throw new Error("the session started no provider turn");
  }
  const sessionId = outcome.snapshot.session.id;
  provider.startWork(turn.turnId);
  const snapshot = await setup.engine.open(sessionId);
  provider.sink.exited(FAKE_EXIT);
  await pollUntil(
    () => setup.store.readEvents(sessionId),
    (events) => events.some((event) => event.type === "checkpoint.captured"),
    { intervalMs: POLL_INTERVAL_MS, timeoutMs: POLL_TIMEOUT_MS },
  );
  return { sessionId, turnId: turn.turnId, provider, lastSeqBeforeExit: snapshot.lastSeq };
}

function appendedAfter(events: readonly SessionEvent[], seq: number): readonly SessionEvent[] {
  return events.filter((event) => event.seq > seq);
}

describe("a provider that exits mid-turn", () => {
  it("closes the open request, the running tool and the turn as failed, then checkpoints it", async () => {
    const setup = await harness();
    const died = await dieMidTurn(setup);

    const events = await setup.store.readEvents(died.sessionId);
    const scope = { sessionId: died.sessionId, at: AT, turnId: died.turnId };
    expect(appendedAfter(events, died.lastSeqBeforeExit)).toEqual([
      {
        ...scope,
        id: expect.any(String),
        seq: died.lastSeqBeforeExit + 1,
        type: "request.resolved",
        requestId: REQUEST_ID,
        resolution: { kind: "expired" },
      },
      {
        ...scope,
        id: expect.any(String),
        seq: died.lastSeqBeforeExit + 2,
        type: "tool.completed",
        callId: CALL_ID,
        status: "error",
        output: FAKE_EXIT.toolMessage,
        files: [],
        patch: null,
      },
      {
        ...scope,
        id: expect.any(String),
        seq: died.lastSeqBeforeExit + 3,
        type: "turn.completed",
        outcome: { kind: "failed", message: FAKE_EXIT.turnMessage },
        usage: null,
        durationMs: 0,
      },
      {
        ...scope,
        id: expect.any(String),
        seq: died.lastSeqBeforeExit + 4,
        type: "checkpoint.captured",
        ref: checkpointRef(died.sessionId, 1),
        files: [],
      },
    ]);
  });

  it("leaves the session idle rather than failed", async () => {
    const setup = await harness();
    const died = await dieMidTurn(setup);

    const snapshot = await setup.engine.open(died.sessionId);
    expect(snapshot.session.activity).toEqual({ kind: "idle" });
  });

  it("stops the dead provider and starts a fresh one resuming the conversation for the next turn", async () => {
    const setup = await harness();
    const died = await dieMidTurn(setup);

    await setup.engine.sendTurn({ sessionId: died.sessionId, text: FOLLOW_UP, attachments: [] });

    expect(
      setup.started.map((provider) => ({
        resume: provider.input.resume,
        turns: provider.turns.map((turn) => turn.text),
        stopped: provider.stopped,
      })),
    ).toEqual([
      { resume: null, turns: [FIRST_PROMPT], stopped: true },
      { resume: NATIVE_SESSION_ID, turns: [FOLLOW_UP], stopped: false },
    ]);
  });
});
