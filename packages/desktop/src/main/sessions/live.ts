import { errorMessage } from "@metabase/client/errors";

import { SessionEvent, type SessionEventInput } from "../../contracts/events";
import { applyEvent } from "../../contracts/projector";
import type { SessionEventBatch, SessionSnapshot } from "../../contracts/session";
import type {
  AnswerInput,
  ProviderAdapter,
  ProviderExit,
  ProviderSession,
  SessionSink,
  StartSessionInput,
  TurnInput,
} from "../providers/adapter";
import type { ProviderLog } from "../providers/log";

import type { SessionStore } from "./store";

// One animation frame at 60 Hz. Events arrive far faster than that while a model streams, and the
// renderer only needs the batch that is on screen next.
const PUSH_INTERVAL_MS = 16;

const NO_PROVIDER_MESSAGE = "This session has no agent running.";

export interface LiveSessionDeps {
  readonly snapshot: SessionSnapshot;
  readonly store: SessionStore;
  readonly publish: (batch: SessionEventBatch) => void;
  readonly onFailure: (message: string) => void;
}

type TurnListener = (turnId: string) => void;
type ExitListener = (exit: ProviderExit) => void;

export class LiveSession {
  private current: SessionSnapshot;
  private seq: number;
  private provider: ProviderSession | null = null;
  private log: ProviderLog | null = null;
  private brokerSessionId: string | null = null;
  private queued: SessionEvent[] = [];
  private push: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private turnListener: TurnListener | null = null;
  private exitListener: ExitListener | null = null;

  constructor(private readonly deps: LiveSessionDeps) {
    this.current = deps.snapshot;
    this.seq = deps.snapshot.lastSeq;
  }

  get snapshot(): SessionSnapshot {
    return this.current;
  }

  hasProvider(): boolean {
    return this.provider !== null;
  }

  nextCheckpointSeq(): number {
    return this.current.session.lastCheckpointSeq + 1;
  }

  onTurnCompleted(listener: TurnListener): void {
    this.turnListener = listener;
  }

  onProviderExited(listener: ExitListener): void {
    this.exitListener = listener;
  }

  holdResources(log: ProviderLog, brokerSessionId: string | null): void {
    this.log = log;
    this.brokerSessionId = brokerSessionId;
  }

  // The snapshot advances before the write is scheduled, so the order events reach the renderer and
  // the order they reach the log are the order they were emitted in.
  emit(input: SessionEventInput): Promise<void> {
    const event = SessionEvent.parse({ ...input, seq: this.seq + 1 });
    this.seq = event.seq;
    this.current = applyEvent(this.current, event);
    this.queued.push(event);
    this.schedulePush();
    if (event.type === "turn.completed") {
      this.turnListener?.(event.turnId);
    }
    return this.persist([event]);
  }

  persist(events: readonly SessionEvent[]): Promise<void> {
    this.writes = this.writes.then(async () => {
      try {
        await this.deps.store.appendEvents(this.current.session.id, events);
      } catch (error) {
        this.deps.onFailure(`the session log could not be written: ${errorMessage(error)}`);
      }
    });
    return this.writes;
  }

  async start(adapter: ProviderAdapter, input: StartSessionInput): Promise<void> {
    // The adapter is mid-stream when it emits; an event the log refuses is recorded as a fault
    // rather than thrown back into the provider's own loop.
    const sink: SessionSink = {
      emit: (event) => {
        try {
          void this.emit(event);
        } catch (error) {
          this.deps.onFailure(
            `the provider produced an event the log refused: ${errorMessage(error)}`,
          );
        }
      },
      exited: (exit) => {
        this.exitListener?.(exit);
      },
    };
    this.provider = await adapter.start(input, sink);
  }

  sendTurn(input: TurnInput): Promise<void> {
    return this.requireProvider().sendTurn(input);
  }

  answer(input: AnswerInput): Promise<void> {
    return this.requireProvider().answer(input);
  }

  interrupt(): Promise<void> {
    return this.requireProvider().interrupt();
  }

  async stop(): Promise<string | null> {
    const provider = this.provider;
    this.provider = null;
    this.turnListener = null;
    this.exitListener = null;
    if (provider !== null) {
      await provider.stop();
    }
    await this.writes;
    this.flush();
    if (this.log !== null) {
      await this.log.close();
      this.log = null;
    }
    const brokerSessionId = this.brokerSessionId;
    this.brokerSessionId = null;
    return brokerSessionId;
  }

  private requireProvider(): ProviderSession {
    if (this.provider === null) {
      throw new Error(NO_PROVIDER_MESSAGE);
    }
    return this.provider;
  }

  private schedulePush(): void {
    if (this.push !== null) {
      return;
    }
    const timer = setTimeout(() => {
      this.push = null;
      this.flush();
    }, PUSH_INTERVAL_MS);
    timer.unref();
    this.push = timer;
  }

  private flush(): void {
    if (this.push !== null) {
      clearTimeout(this.push);
      this.push = null;
    }
    const events = this.queued;
    if (events.length === 0) {
      return;
    }
    this.queued = [];
    this.deps.publish({ sessionId: this.current.session.id, events });
  }
}
