import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { query, type CanUseTool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { PermissionMode } from "../src/contracts/events";
import type { RecordedFrame } from "../src/main/providers/claude/fixtures";
import { QuestionToolInput, answeredQuestions } from "../src/main/providers/claude/questions";
import { claudeQueryOptions } from "../src/main/providers/claude/session";
import { CodexClient } from "../src/main/providers/codex/client";
import { recordedLine, type RecordedLine } from "../src/main/providers/codex/fixtures";
import {
  CODEX_ARGS,
  CODEX_METHOD,
  InitializeResult,
  ThreadResult,
  TurnResult,
} from "../src/main/providers/codex/protocol";
import {
  APPROVAL_METHOD,
  ACCEPT_OPTION_ID,
  USER_INPUT_METHOD,
  approvalAnswer,
  userInputAnswer,
} from "../src/main/providers/codex/requests";
import { initializeParams, threadParams } from "../src/main/providers/codex/session";
import type { ProviderLog } from "../src/main/providers/log";
import { startProcess } from "../src/main/process/spawn";

import { DriverFailure } from "./app";

const FIXTURE_ROOT = join(import.meta.dirname, "..", "src", "main", "providers");

const CLAUDE_BINARY_ENV_VAR = "RDE_RECORD_CLAUDE_BINARY";
const CODEX_BINARY_ENV_VAR = "RDE_RECORD_CODEX_BINARY";
const RESUME_ENV_VAR = "RDE_RECORD_RESUME";
const WORKSPACE_ENV_VAR = "RDE_RECORD_WORKSPACE";

const CLAUDE_PROVIDER = "claude";
const CODEX_PROVIDER = "codex";
const TURN_DEADLINE_MS = 60_000;

const SessionCarrier = z.object({ session_id: z.string().min(1) }).loose();

// A recording loads no filesystem settings, so the fixture carries the commands, skills and hooks
// Claude Code ships with rather than whatever the recording machine has installed.
const RECORDING_SETTING_SOURCES: NonNullable<Options["settingSources"]> = [];

interface ClaudeScenario {
  readonly name: string;
  readonly prompt: string;
  readonly permissionMode: PermissionMode;
}

const CLAUDE_SCENARIOS: readonly ClaudeScenario[] = [
  {
    name: "turn",
    prompt: "Create a file named hello.txt containing hello and stop.",
    permissionMode: "ask",
  },
  {
    name: "resume",
    prompt: "Now delete hello.txt and stop.",
    permissionMode: "ask",
  },
  {
    name: "question",
    prompt:
      "Use the AskUserQuestion tool to ask me whether this repository should use tabs or spaces. Do nothing else.",
    permissionMode: "ask",
  },
];

function claudeScenarioNamed(name: string): ClaudeScenario {
  const scenario = CLAUDE_SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    const names = CLAUDE_SCENARIOS.map((candidate) => candidate.name).join(", ");
    throw new DriverFailure(`Unknown scenario "${name}"; the recorder knows ${names}`);
  }
  return scenario;
}

function definedEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new DriverFailure(`${name} is not set`);
  }
  return value;
}

function optionalEnvVar(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? null : value;
}

function approveEverything(frames: RecordedFrame[]): CanUseTool {
  return (toolName, input, options) => {
    frames.push({
      kind: "permission",
      toolName,
      input,
      toolUseID: options.toolUseID,
      title: options.title ?? null,
      suggestionCount: options.suggestions?.length ?? 0,
    });
    const asked = QuestionToolInput.safeParse(input);
    if (!asked.success) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    const answers = answeredQuestions(asked.data, (question) => [question.options[0].label]);
    return Promise.resolve({ behavior: "allow", updatedInput: { ...input, answers } });
  };
}

async function recordClaude(scenario: ClaudeScenario): Promise<readonly RecordedFrame[]> {
  const frames: RecordedFrame[] = [];
  const abortController = new AbortController();
  const session = query({
    prompt: scenario.prompt,
    options: claudeQueryOptions({
      binaryPath: definedEnvVar(CLAUDE_BINARY_ENV_VAR),
      cwd: definedEnvVar(WORKSPACE_ENV_VAR),
      model: null,
      permissionMode: scenario.permissionMode,
      resume: optionalEnvVar(RESUME_ENV_VAR),
      env: process.env,
      systemAppend: null,
      settingSources: RECORDING_SETTING_SOURCES,
      abortController,
      canUseTool: approveEverything(frames),
    }),
  });
  for await (const message of session) {
    frames.push({ kind: "message", message });
  }
  return frames;
}

function nativeSessionId(frames: readonly RecordedFrame[]): string | null {
  for (const frame of frames) {
    if (frame.kind !== "message") {
      continue;
    }
    const carrier = SessionCarrier.safeParse(frame.message);
    if (carrier.success) {
      return carrier.data.session_id;
    }
  }
  return null;
}

interface CodexScenario {
  readonly name: string;
  readonly prompt: string;
  readonly permissionMode: PermissionMode;
}

const CODEX_SCENARIOS: readonly CodexScenario[] = [
  {
    name: "handshake",
    prompt: "Create a file named hello.txt containing hello and stop.",
    permissionMode: "edits",
  },
];

function codexScenarioNamed(name: string): CodexScenario {
  const scenario = CODEX_SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    const names = CODEX_SCENARIOS.map((candidate) => candidate.name).join(", ");
    throw new DriverFailure(`Unknown scenario "${name}"; the recorder knows ${names}`);
  }
  return scenario;
}

function recordingLog(into: RecordedLine[]): ProviderLog {
  return {
    write: (chunk) => {
      for (const entry of chunk.split("\n")) {
        const recorded = recordedLine(entry);
        if (recorded !== null) {
          into.push(recorded);
        }
      }
    },
    close: () => Promise.resolve(),
  };
}

async function recordCodex(scenario: CodexScenario): Promise<readonly RecordedLine[]> {
  const workspace = definedEnvVar(WORKSPACE_ENV_VAR);
  const child = startProcess({
    command: definedEnvVar(CODEX_BINARY_ENV_VAR),
    args: [...CODEX_ARGS],
    env: process.env,
    cwd: workspace,
  });
  if (child.kind === "start-failed") {
    throw new DriverFailure(`codex app-server did not start: ${child.message}`);
  }
  const lines: RecordedLine[] = [];
  let ended: (() => void) | null = null;
  const turnEnded = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const client: CodexClient = new CodexClient({
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    log: recordingLog(lines),
    handlers: {
      onNotification: (notification) => {
        if (notification.method === "turn/completed") {
          ended?.();
        }
      },
      onRequest: (request) => {
        answerRecording(client, request.id, request.method);
      },
      onProtocolError: (error) => {
        process.stderr.write(`${error.message}\n`);
      },
      onStderr: () => {},
    },
  });
  await client.request(CODEX_METHOD.initialize, initializeParams(), InitializeResult);
  client.notify(CODEX_METHOD.initialized);
  const thread = await client.request(
    CODEX_METHOD.threadStart,
    threadParams({
      cwd: workspace,
      model: null,
      permissionMode: scenario.permissionMode,
      systemAppend: null,
    }),
    ThreadResult,
  );
  await client.request(
    CODEX_METHOD.turnStart,
    { threadId: thread.thread.id, input: [{ type: "text", text: scenario.prompt }] },
    TurnResult,
  );
  await Promise.race([turnEnded, sleep(TURN_DEADLINE_MS)]);
  client.close();
  await child.stop();
  return lines;
}

function answerRecording(client: CodexClient, id: number | string, method: string): void {
  if (method === USER_INPUT_METHOD) {
    client.respond(id, userInputAnswer(new Map<string, string>()));
    return;
  }
  const approval = Object.values(APPROVAL_METHOD).some((candidate) => candidate === method);
  if (approval) {
    client.respond(id, approvalAnswer(ACCEPT_OPTION_ID));
    return;
  }
  process.stderr.write(`no answer for ${method}\n`);
}

async function writeFixture(
  provider: string,
  scenario: string,
  frames: readonly object[],
): Promise<string> {
  const directory = join(FIXTURE_ROOT, provider, "fixtures");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${scenario}.jsonl`);
  await writeFile(path, `${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`, "utf8");
  process.stdout.write(`${frames.length} frames -> ${path}\n`);
  return path;
}

async function main(): Promise<void> {
  const provider = process.argv[2];
  const name = process.argv[3];
  if (provider === undefined || name === undefined) {
    throw new DriverFailure("Name the provider and the scenario to record");
  }
  if (provider === CLAUDE_PROVIDER) {
    const scenario = claudeScenarioNamed(name);
    const frames = await recordClaude(scenario);
    await writeFixture(CLAUDE_PROVIDER, scenario.name, [...frames]);
    process.stdout.write(`session ${nativeSessionId(frames) ?? "unknown"}\n`);
    return;
  }
  if (provider === CODEX_PROVIDER) {
    const scenario = codexScenarioNamed(name);
    await writeFixture(CODEX_PROVIDER, scenario.name, [...(await recordCodex(scenario))]);
    return;
  }
  throw new DriverFailure(
    `Unknown provider "${provider}"; the recorder knows ${CLAUDE_PROVIDER}, ${CODEX_PROVIDER}`,
  );
}

await main();
