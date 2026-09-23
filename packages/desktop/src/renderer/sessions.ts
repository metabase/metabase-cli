import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionOutcome } from "../contracts/changes";
import { applyEvent, pendingRequests } from "../contracts/projector";
import {
  SESSION_STORE_VERSION,
  type CreateSessionRequest,
  type SessionEventBatch,
  type SessionIndex,
  type SessionSnapshot,
} from "../contracts/session";

import { rde } from "./bridge";
import type { SessionPulse } from "./pulse";
import { RESTING, pulseAfter } from "./pulse";

const EMPTY_INDEX: SessionIndex = { version: SESSION_STORE_VERSION, sessions: [] };
const NO_FILES: readonly string[] = [];

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A batch can arrive while the snapshot is still being fetched, and the fetched snapshot already
// holds what the batch carries; replaying by sequence number makes a double delivery harmless.
function applyBatch(snapshot: SessionSnapshot, batch: SessionEventBatch): SessionSnapshot {
  if (batch.sessionId !== snapshot.session.id) {
    return snapshot;
  }
  return batch.events.filter((event) => event.seq > snapshot.lastSeq).reduce(applyEvent, snapshot);
}

function foldPulses(
  current: ReadonlyMap<string, SessionPulse>,
  batch: SessionEventBatch,
): ReadonlyMap<string, SessionPulse> {
  const before = current.get(batch.sessionId) ?? RESTING;
  const after = pulseAfter(before, batch.events);
  if (after === before) {
    return current;
  }
  return new Map(current).set(batch.sessionId, after);
}

export interface SessionsController {
  readonly index: SessionIndex;
  readonly snapshot: SessionSnapshot | null;
  readonly pulses: ReadonlyMap<string, SessionPulse>;
  readonly files: readonly string[];
  readonly working: boolean;
  readonly failure: string | null;
  readonly create: (request: CreateSessionRequest) => Promise<void>;
  readonly open: (sessionId: string) => Promise<void>;
  readonly leave: () => void;
  readonly sendTurn: (text: string) => Promise<void>;
  readonly answer: (requestId: string, optionId: string) => Promise<void>;
  readonly interrupt: () => Promise<void>;
  readonly pin: (sessionId: string, pinned: boolean) => Promise<void>;
  readonly archive: (sessionId: string) => Promise<void>;
  readonly rewind: (turnId: string, restoreFiles: boolean) => Promise<ActionOutcome>;
}

export function useSessions(): SessionsController {
  const [index, setIndex] = useState<SessionIndex>(EMPTY_INDEX);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [pulses, setPulses] = useState<ReadonlyMap<string, SessionPulse>>(new Map());
  const [files, setFiles] = useState<readonly string[]>(NO_FILES);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const openId = useRef<string | null>(null);

  useEffect(() => {
    void rde.sessionsList().then(setIndex, (error: unknown) => {
      setFailure(failureMessage(error));
    });
    void rde.repositoryFiles().then(
      (tracked) => {
        setFiles(tracked.paths);
      },
      (error: unknown) => {
        setFailure(failureMessage(error));
      },
    );
  }, []);

  useEffect(
    () =>
      rde.onSessionEvents((batch) => {
        setSnapshot((current) => (current === null ? current : applyBatch(current, batch)));
        setPulses((current) => foldPulses(current, batch));
      }),
    [],
  );

  const adopt = useCallback((next: SessionSnapshot): void => {
    openId.current = next.session.id;
    setSnapshot(next);
    setPulses((current) =>
      new Map(current).set(next.session.id, {
        activity: next.session.activity,
        openRequests: pendingRequests(next).length,
      }),
    );
  }, []);

  const guard = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setWorking(true);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setWorking(false);
    }
  }, []);

  const create = useCallback(
    (request: CreateSessionRequest): Promise<void> =>
      guard(async () => {
        const outcome = await rde.sessionsCreate(request);
        if (outcome.kind === "refused") {
          setFailure(outcome.message);
          return;
        }
        adopt(outcome.snapshot);
        setIndex(await rde.sessionsList());
      }),
    [adopt, guard],
  );

  const open = useCallback(
    (sessionId: string): Promise<void> =>
      guard(async () => {
        adopt(await rde.sessionsOpen({ sessionId }));
      }),
    [adopt, guard],
  );

  const leave = useCallback((): void => {
    openId.current = null;
    setSnapshot(null);
  }, []);

  const withOpenSession = useCallback(
    (work: (sessionId: string) => Promise<void>): Promise<void> =>
      guard(async () => {
        const sessionId = openId.current;
        if (sessionId === null) {
          return;
        }
        await work(sessionId);
      }),
    [guard],
  );

  const sendTurn = useCallback(
    (text: string): Promise<void> =>
      withOpenSession(async (sessionId) => {
        await rde.sessionsSendTurn({ sessionId, text, attachments: [] });
      }),
    [withOpenSession],
  );

  const answer = useCallback(
    (requestId: string, optionId: string): Promise<void> =>
      withOpenSession(async (sessionId) => {
        await rde.sessionsAnswer({ sessionId, requestId, optionId, text: null });
      }),
    [withOpenSession],
  );

  const interrupt = useCallback(
    (): Promise<void> =>
      withOpenSession(async (sessionId) => {
        await rde.sessionsInterrupt({ sessionId });
      }),
    [withOpenSession],
  );

  const pin = useCallback(
    (sessionId: string, pinned: boolean): Promise<void> =>
      guard(async () => {
        setIndex(await rde.sessionsPin({ sessionId, pinned }));
      }),
    [guard],
  );

  const archive = useCallback(
    (sessionId: string): Promise<void> =>
      guard(async () => {
        const outcome = await rde.sessionsArchive({ sessionId });
        setIndex(outcome.index);
        if (openId.current === sessionId) {
          openId.current = null;
          setSnapshot(null);
        }
      }),
    [guard],
  );

  // A refusal goes back to the dialog that asked, which shows it in place.
  const rewind = useCallback(
    async (turnId: string, restoreFiles: boolean): Promise<ActionOutcome> => {
      const sessionId = openId.current;
      if (sessionId === null) {
        return { kind: "refused", message: "No session is open." };
      }
      try {
        adopt(await rde.sessionsRewind({ sessionId, turnId, restoreFiles }));
        return { kind: "done" };
      } catch (error) {
        return { kind: "refused", message: failureMessage(error) };
      }
    },
    [adopt],
  );

  return {
    index,
    snapshot,
    pulses,
    files,
    working,
    failure,
    create,
    open,
    leave,
    sendTurn,
    answer,
    interrupt,
    pin,
    archive,
    rewind,
  };
}
