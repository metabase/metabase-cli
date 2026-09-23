import type { UUID } from "node:crypto";

import type {
  EventId,
  MessageId,
  PermissionMode,
  RewoundConversation,
  SessionEventInput,
  SessionId,
  TurnId,
} from "../../contracts/events";
import type {
  ProviderAccount,
  ProviderKind,
  ProviderModel,
  ProviderStatus,
} from "../../contracts/providers";
import type { RunCommand } from "../process/spawn";

import type { ProviderLog } from "./log";

type ProbeStatus = Exclude<ProviderStatus, "missing">;

export interface ProviderProbeInput {
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: RunCommand;
  readonly signal: AbortSignal;
}

export interface ProviderProbeResult {
  readonly status: ProbeStatus;
  readonly account: ProviderAccount | null;
  readonly message: string | null;
}

export interface EventSink {
  emit(event: SessionEventInput): void;
}

// The provider's own wording for a process that ended while nothing asked it to stop: the turn it
// was running closes with `turnMessage`, and every tool it left running with `toolMessage`.
export interface ProviderExit {
  readonly turnMessage: string;
  readonly toolMessage: string;
}

export interface SessionSink extends EventSink {
  exited(exit: ProviderExit): void;
}

export interface SessionClock {
  now(): string;
  eventId(): EventId;
}

export interface StartSessionInput {
  readonly sessionId: SessionId;
  readonly binaryPath: string;
  readonly cwd: string;
  // Null only for a session logged before every session named its model.
  readonly model: string | null;
  readonly permissionMode: PermissionMode;
  readonly resume: string | null;
  readonly env: NodeJS.ProcessEnv;
  readonly systemAppend: string | null;
  readonly extraArgs: readonly string[];
  readonly clock: SessionClock;
  readonly log: ProviderLog;
  readonly signal: AbortSignal;
}

// `promptId` is a UUID naming the prompt inside the provider's own conversation, which is what lets
// the conversation be cut back to just before it.
export interface TurnInput {
  readonly turnId: TurnId;
  readonly messageId: MessageId;
  readonly promptId: UUID;
  readonly text: string;
  readonly attachments: readonly string[];
}

export interface AnswerInput {
  readonly requestId: string;
  readonly optionId: string;
  readonly text: string | null;
}

export interface ProviderSession {
  sendTurn(input: TurnInput): Promise<void>;
  answer(input: AnswerInput): Promise<void>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  readonly nativeSessionId: string | null;
}

// `defaultModel` is the id of the entry in `models` the agent runs when told nothing.
export interface ModelCatalog {
  readonly models: readonly ProviderModel[];
  readonly defaultModel: string;
}

export interface ModelListingInput {
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
}

// `fallbackModels` stands in when the agent is missing, signed out, or cannot list its models;
// `listModels` answers null then.
export interface ProviderProbe {
  readonly kind: ProviderKind;
  readonly binaryName: string;
  readonly fallbackModels: ModelCatalog;
  listModels(input: ModelListingInput): Promise<ModelCatalog | null>;
  probe(input: ProviderProbeInput): Promise<ProviderProbeResult>;
}

export interface RewindInput {
  readonly nativeSessionId: string;
  readonly cwd: string;
  readonly promptId: UUID;
}

interface ProviderCannotRewind {
  readonly kind: "unsupported";
  readonly reason: string;
}

export type RewindOutcome =
  | Exclude<RewoundConversation, { readonly kind: "replayed" }>
  | ProviderCannotRewind;

export interface ProviderAdapter extends ProviderProbe {
  start(input: StartSessionInput, sink: SessionSink): Promise<ProviderSession>;
  rewind(input: RewindInput): Promise<RewindOutcome>;
}
