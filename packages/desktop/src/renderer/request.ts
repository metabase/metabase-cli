import { useCallback, useState } from "react";

interface RequestIdle {
  readonly status: "idle";
}

interface RequestRunning {
  readonly status: "running";
}

interface RequestFailed {
  readonly status: "failed";
  readonly message: string;
}

interface RequestReady<Value> {
  readonly status: "ready";
  readonly value: Value;
}

export type RequestState<Value> =
  | RequestIdle
  | RequestRunning
  | RequestFailed
  | RequestReady<Value>;

const IDLE: RequestIdle = { status: "idle" };
const RUNNING: RequestRunning = { status: "running" };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Request<Value> {
  readonly state: RequestState<Value>;
  readonly send: (call: () => Promise<Value>) => Promise<void>;
  readonly update: (next: (value: Value) => Value) => void;
}

export function requestFailure(state: RequestState<unknown>): string | null {
  return state.status === "failed" ? state.message : null;
}

export function useRequest<Value>(): Request<Value> {
  const [state, setState] = useState<RequestState<Value>>(IDLE);

  const send = useCallback(async (call: () => Promise<Value>): Promise<void> => {
    setState(RUNNING);
    try {
      const value = await call();
      setState({ status: "ready", value });
    } catch (error) {
      setState({ status: "failed", message: failureMessage(error) });
    }
  }, []);

  const update = useCallback((next: (value: Value) => Value): void => {
    setState((current) =>
      current.status === "ready" ? { status: "ready", value: next(current.value) } : current,
    );
  }, []);

  return { state, send, update };
}
