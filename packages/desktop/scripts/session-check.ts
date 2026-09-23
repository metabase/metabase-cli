import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionEventInput } from "../src/contracts/events";
import type {
  ProviderExit,
  ProviderSession,
  SessionClock,
  SessionSink,
} from "../src/main/providers/adapter";
import { claudeAdapter } from "../src/main/providers/claude/adapter";
import { openProviderLog } from "../src/main/providers/log";
import { startProcess } from "../src/main/process/spawn";

import { DriverFailure, evidenceDir, timestamp } from "./app";

const BINARY_ENV_VAR = "RDE_SESSION_CLAUDE_BINARY";
const EVIDENCE_NAME = "u3-claude";
const SESSION_ID = "ses_u3";
const WRITE_TURN = "Create a file named hello.txt containing hello and stop.";
const DELETE_TURN = "Now delete hello.txt and stop.";
const TARGET_FILE = "hello.txt";
const ALLOW_OPTION = "allow";
const TURN_TIMEOUT_MS = 180_000;

interface Waiter {
  readonly matches: (event: SessionEventInput) => boolean;
  readonly settle: () => void;
  readonly fail: (failure: DriverFailure) => void;
}

class Transcript implements SessionSink {
  readonly events: SessionEventInput[] = [];
  private readonly waiters: Waiter[] = [];
  private answer: ((requestId: string) => void) | null = null;

  onRequest(answer: (requestId: string) => void): void {
    this.answer = answer;
  }

  emit(event: SessionEventInput): void {
    this.events.push(event);
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.matches(event)) {
        waiter.settle();
        continue;
      }
      this.waiters.push(waiter);
    }
    const answer = this.answer;
    if (event.type === "request.opened" && answer !== null) {
      answer(event.requestId);
    }
  }

  await(matches: (event: SessionEventInput) => boolean): Promise<void> {
    if (this.events.some(matches)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new DriverFailure("No turn completed within the timeout"));
      }, TURN_TIMEOUT_MS);
      this.waiters.push({
        matches,
        settle: () => {
          clearTimeout(timer);
          resolve();
        },
        fail: (failure) => {
          clearTimeout(timer);
          reject(failure);
        },
      });
    });
  }

  exited(exit: ProviderExit): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.fail(new DriverFailure(exit.turnMessage));
    }
  }

  kinds(): readonly string[] {
    return this.events.map((event) => event.type);
  }
}

function countingClock(): SessionClock {
  let ids = 0;
  return {
    eventId: () => `evt_${++ids}`,
    now: () => new Date().toISOString(),
  };
}

function definedEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new DriverFailure(`${name} is not set`);
  }
  return value;
}

async function initRepository(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "rde-session-"));
  const started = startProcess({
    command: "git",
    args: ["init", "--quiet", workspace],
    env: process.env,
    cwd: workspace,
  });
  if (started.kind === "start-failed") {
    throw new DriverFailure(`git could not be started: ${started.message}`);
  }
  const exit = await started.exited;
  if (exit.kind === "failed" || exit.code !== 0) {
    throw new DriverFailure(`git init did not succeed in ${workspace}`);
  }
  return workspace;
}

interface TurnRun {
  readonly session: ProviderSession;
  readonly transcript: Transcript;
}

async function runTurn(
  workspace: string,
  logDirectory: string,
  resume: string | null,
  text: string,
): Promise<TurnRun> {
  const transcript = new Transcript();
  const interrupt = new AbortController();
  const session = await claudeAdapter.start(
    {
      sessionId: SESSION_ID,
      binaryPath: definedEnvVar(BINARY_ENV_VAR),
      cwd: workspace,
      model: null,
      permissionMode: "ask",
      resume,
      env: process.env,
      systemAppend: null,
      extraArgs: [],
      clock: countingClock(),
      log: await openProviderLog({
        directory: logDirectory,
        sessionId: SESSION_ID,
        secrets: [],
      }),
      signal: interrupt.signal,
    },
    transcript,
  );
  transcript.onRequest((requestId) => {
    void session.answer({ requestId, optionId: ALLOW_OPTION, text: null });
  });
  await session.sendTurn({
    turnId: resume === null ? "turn_write" : "turn_delete",
    messageId: resume === null ? "msg_write" : "msg_delete",
    promptId: randomUUID(),
    text,
    attachments: [],
  });
  await transcript.await((event) => event.type === "turn.completed");
  return { session, transcript };
}

function requireKinds(transcript: Transcript, expected: readonly string[]): void {
  const seen = new Set(transcript.kinds());
  const missing = expected.filter((kind) => !seen.has(kind));
  if (missing.length > 0) {
    throw new DriverFailure(`The session never emitted ${missing.join(", ")}`);
  }
}

function describe(events: readonly SessionEventInput[]): string {
  return events
    .map((event) => {
      if (event.type === "tool.started") {
        return `${event.type} ${event.tool} ${event.label}`;
      }
      if (event.type === "tool.completed") {
        return `${event.type} ${event.status} [${event.files.join(", ")}]`;
      }
      if (event.type === "request.opened") {
        return `${event.type} ${event.kind} ${event.options.map((option) => option.id).join("/")}`;
      }
      if (event.type === "request.resolved") {
        return `${event.type} ${event.resolution.kind}`;
      }
      if (event.type === "turn.completed") {
        return `${event.type} ${event.outcome.kind}`;
      }
      return event.type;
    })
    .join("\n");
}

async function main(): Promise<void> {
  const dir = await evidenceDir(process.env);
  const workspace = await initRepository();
  const logDirectory = join(workspace, "logs", "providers");
  const lines: string[] = [
    `RDE_SESSION_CLAUDE_BINARY=$(mise which claude) bun scripts/session-check.ts   # one Claude session per Done-when, in ${workspace}`,
  ];

  const write = await runTurn(workspace, logDirectory, null, WRITE_TURN);
  const native = write.session.nativeSessionId;
  await write.session.stop();
  requireKinds(write.transcript, [
    "tool.started",
    "request.opened",
    "request.resolved",
    "tool.completed",
    "turn.completed",
  ]);
  const afterWrite = await readdir(workspace);
  if (!afterWrite.includes(TARGET_FILE)) {
    throw new DriverFailure(`${TARGET_FILE} is not in ${afterWrite.join(", ")}`);
  }
  if (native === null) {
    throw new DriverFailure("The session reported no native id to resume from");
  }
  lines.push("", `# turn one, fresh session ${native}`, describe(write.transcript.events));

  const remove = await runTurn(workspace, logDirectory, native, DELETE_TURN);
  await remove.session.stop();
  requireKinds(remove.transcript, ["tool.started", "tool.completed", "turn.completed"]);
  const afterDelete = await readdir(workspace);
  if (afterDelete.includes(TARGET_FILE)) {
    throw new DriverFailure(`${TARGET_FILE} survived the resumed turn`);
  }
  lines.push("", `# turn two, resumed on ${native}`, describe(remove.transcript.events));
  lines.push("", `# ${TARGET_FILE} was created by turn one and deleted by turn two`);

  const path = join(dir, `${timestamp()}_${EVIDENCE_NAME}.log`);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`${path}\n`);
  await rm(workspace, { recursive: true, force: true });
}

await main();
