import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { errorMessage } from "@metabase/client/errors";

import type { PermissionMode } from "../../../contracts/events";
import type {
  AnswerInput,
  ProviderExit,
  ProviderSession,
  SessionSink,
  StartSessionInput,
  TurnInput,
} from "../adapter";
import type { ProviderLog } from "../log";

import { ClaudeMessageMapper } from "./messages";
import { answeredQuestions, type AskedQuestion, type QuestionToolInput } from "./questions";
import {
  ALLOW_ALWAYS_OPTION_ID,
  ALLOW_OPTION_ID,
  DENY_OPTION_ID,
  type PermissionRequest,
} from "./requests";
import { SDK_PERMISSION_MODES } from "./wire";

type ToolInput = Parameters<CanUseTool>[1];
type PermissionSuggestions = Parameters<CanUseTool>[2]["suggestions"];
type AnswerResolver = (answer: AnswerInput) => PermissionResult;
type SystemPromptPreset = Extract<NonNullable<Options["systemPrompt"]>, { type: "preset" }>;

export const SESSION_SETTING_SOURCES: NonNullable<Options["settingSources"]> = ["user", "project"];
// No filesystem skill reaches the model: a user- or repo-level Metabase skill describes another
// CLI, and the app's method comes from `mb skills` alone.
const SESSION_SKILLS: NonNullable<Options["skills"]> = [];
const ATTACHMENT_PREFIX = "@";
const DECLINED_MESSAGE = "The user declined this tool call.";
const STOPPED_MESSAGE = "The session stopped before this tool call was answered.";
const NO_TURN_MESSAGE = "The session has no turn in flight, so this tool call cannot be answered.";
const EXITED_NOTE = "Claude Code exited: ";
const ENDED_NOTE = "Claude Code ended its stream without being asked to stop\n";
const CLAUDE_EXIT: ProviderExit = {
  turnMessage:
    "Claude Code stopped in the middle of this turn. Send a message to carry on; the conversation picks up where it stopped.",
  toolMessage: "Claude Code stopped before this finished.",
};
const RESUME_REFUSED_MARKERS: readonly string[] = [
  "unknown session",
  "no such session",
  "session not found",
];

export interface ClaudeLaunchOptions {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly model: string | null;
  readonly permissionMode: PermissionMode;
  readonly resume: string | null;
  readonly env: NodeJS.ProcessEnv;
  readonly systemAppend: string | null;
  readonly settingSources: NonNullable<Options["settingSources"]>;
  readonly abortController: AbortController;
  readonly canUseTool: CanUseTool;
}

function claudeCodePreset(append: string): SystemPromptPreset {
  return { type: "preset", preset: "claude_code", append };
}

export function claudeQueryOptions(launch: ClaudeLaunchOptions): Options {
  const bypass =
    launch.permissionMode === "bypass" ? { allowDangerouslySkipPermissions: true } : {};
  const model = launch.model === null ? {} : { model: launch.model };
  const resume = launch.resume === null ? {} : { resume: launch.resume };
  const append =
    launch.systemAppend === null ? {} : { systemPrompt: claudeCodePreset(launch.systemAppend) };
  return {
    cwd: launch.cwd,
    env: launch.env,
    pathToClaudeCodeExecutable: launch.binaryPath,
    permissionMode: SDK_PERMISSION_MODES[launch.permissionMode],
    includePartialMessages: true,
    settingSources: launch.settingSources,
    skills: SESSION_SKILLS,
    abortController: launch.abortController,
    canUseTool: launch.canUseTool,
    ...bypass,
    ...model,
    ...resume,
    ...append,
  };
}

// The SDK's control requests (`canUseTool`, `interrupt`) only work when the prompt is an async
// iterable, and one `query()` has to carry every turn of the session.
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly waiting: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(message: SDKUserMessage): void {
    this.waiting.push(message);
    this.signal();
  }

  close(): void {
    this.closed = true;
    this.signal();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = null;
    if (wake !== null) {
      wake();
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.waiting.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

interface PendingRequest {
  readonly settle: (result: PermissionResult) => void;
  readonly decide: AnswerResolver;
}

function promptText(input: TurnInput): string {
  if (input.attachments.length === 0) {
    return input.text;
  }
  const mentions = input.attachments.map((path) => `${ATTACHMENT_PREFIX}${path}`);
  return [input.text, ...mentions].join("\n");
}

function userPrompt(input: TurnInput): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: promptText(input) },
    parent_tool_use_id: null,
    uuid: input.promptId,
  };
}

function permissionDecider(input: ToolInput, suggestions: PermissionSuggestions): AnswerResolver {
  return (answer) => {
    if (answer.optionId === ALLOW_OPTION_ID) {
      return { behavior: "allow", updatedInput: input };
    }
    if (answer.optionId === ALLOW_ALWAYS_OPTION_ID && suggestions !== undefined) {
      return { behavior: "allow", updatedInput: input, updatedPermissions: suggestions };
    }
    if (answer.optionId === DENY_OPTION_ID) {
      return { behavior: "deny", message: answer.text ?? DECLINED_MESSAGE };
    }
    throw new Error(`Claude Code was not offered the option "${answer.optionId}"`);
  };
}

function questionDecider(input: ToolInput, question: AskedQuestion): AnswerResolver {
  return (answer) => {
    const asked: QuestionToolInput = { questions: [question] };
    const answers = answeredQuestions(asked, () => [answer.optionId]);
    return { behavior: "allow", updatedInput: { ...input, answers } };
  };
}

function refusedTheResume(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return RESUME_REFUSED_MARKERS.some((marker) => message.includes(marker));
}

class ClaudeSession implements ProviderSession {
  private readonly mapper: ClaudeMessageMapper;
  private readonly log: ProviderLog;
  private readonly sink: SessionSink;
  private readonly abortController = new AbortController();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly launch: ClaudeLaunchOptions;

  private prompts = new PromptQueue();
  private sent: SDKUserMessage[] = [];
  private handle: Query;
  private pump: Promise<void>;
  private resumeRetried = false;
  private stopped = false;

  constructor(input: StartSessionInput, sink: SessionSink) {
    this.log = input.log;
    this.sink = sink;
    this.mapper = new ClaudeMessageMapper({
      sessionId: input.sessionId,
      cwd: input.cwd,
      clock: input.clock,
      sink,
    });
    this.launch = {
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      resume: input.resume,
      env: input.env,
      systemAppend: input.systemAppend,
      settingSources: SESSION_SETTING_SOURCES,
      abortController: this.abortController,
      canUseTool: (toolName, toolInput, options) => this.onPermission(toolName, toolInput, options),
    };
    this.handle = query({ prompt: this.prompts, options: claudeQueryOptions(this.launch) });
    this.pump = this.run();
    if (input.signal.aborted) {
      void this.stop();
      return;
    }
    input.signal.addEventListener("abort", () => {
      void this.stop();
    });
  }

  get nativeSessionId(): string | null {
    return this.mapper.nativeSessionId;
  }

  sendTurn(input: TurnInput): Promise<void> {
    this.mapper.beginTurn(input);
    const prompt = userPrompt(input);
    this.sent.push(prompt);
    this.prompts.push(prompt);
    this.log.write(`${JSON.stringify(prompt)}\n`);
    return Promise.resolve();
  }

  async answer(input: AnswerInput): Promise<void> {
    const request = this.pending.get(input.requestId);
    if (request === undefined) {
      throw new Error(`Claude Code has no open request "${input.requestId}"`);
    }
    this.pending.delete(input.requestId);
    request.settle(request.decide(input));
    this.mapper.resolveRequest(input.requestId, {
      kind: "answered",
      optionId: input.optionId,
      text: input.text,
    });
  }

  async interrupt(): Promise<void> {
    await this.handle.interrupt();
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      await this.pump;
      return;
    }
    this.stopped = true;
    this.prompts.close();
    this.handle.close();
    this.abortController.abort();
    this.settleAll({ behavior: "deny", message: STOPPED_MESSAGE });
    await this.pump;
    await this.log.close();
  }

  private settleAll(result: PermissionResult): void {
    for (const [requestId, request] of this.pending) {
      request.settle(result);
      this.mapper.resolveRequest(requestId, { kind: "expired" });
    }
    this.pending.clear();
  }

  private onPermission(
    toolName: string,
    toolInput: ToolInput,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const request: PermissionRequest = {
      requestId: options.requestId,
      toolName,
      input: toolInput,
      toolUseId: options.toolUseID,
      title: options.title ?? null,
      hasSuggestions: options.suggestions !== undefined && options.suggestions.length > 0,
    };
    this.log.write(`${JSON.stringify({ permission: toolName, toolUseID: request.toolUseId })}\n`);
    return new Promise<PermissionResult>((settle) => {
      const opened = this.mapper.applyPermission(request, (ask) => {
        const decide =
          ask.kind === "question"
            ? questionDecider(toolInput, ask.question)
            : permissionDecider(toolInput, options.suggestions);
        this.pending.set(ask.requestId, { settle, decide });
      });
      if (opened === null) {
        settle({ behavior: "deny", message: NO_TURN_MESSAGE });
      }
    });
  }

  private async run(): Promise<void> {
    try {
      for await (const message of this.handle) {
        this.log.write(`${JSON.stringify(message)}\n`);
        this.mapper.applyMessage(message);
        if (this.mapper.activeTurn === null) {
          this.sent = [];
        }
      }
      if (this.stopped) {
        return;
      }
      this.log.write(ENDED_NOTE);
    } catch (error) {
      if (this.stopped) {
        return;
      }
      if (this.launch.resume !== null && !this.resumeRetried && refusedTheResume(error)) {
        this.restartWithoutResume();
        return;
      }
      this.log.write(`${EXITED_NOTE}${errorMessage(error)}\n`);
    }
    this.settleAll({ behavior: "deny", message: STOPPED_MESSAGE });
    this.sink.exited(CLAUDE_EXIT);
  }

  private restartWithoutResume(): void {
    this.resumeRetried = true;
    this.mapper.forgetNativeSession();
    const replay = this.sent;
    this.sent = [];
    this.prompts = new PromptQueue();
    const options = claudeQueryOptions({ ...this.launch, resume: null });
    this.handle = query({ prompt: this.prompts, options });
    for (const prompt of replay) {
      this.sent.push(prompt);
      this.prompts.push(prompt);
    }
    this.pump = this.run();
  }
}

export function startClaudeSession(
  input: StartSessionInput,
  sink: SessionSink,
): Promise<ProviderSession> {
  return Promise.resolve(new ClaudeSession(input, sink));
}
