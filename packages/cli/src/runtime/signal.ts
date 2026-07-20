import { AbortError, errorMessage, MetabaseError } from "../core/errors";

export interface ProcessAbortHandler {
  signal: AbortSignal;
  uninstall: () => void;
}

export interface CombinedAborts {
  combined: AbortSignal;
  processSignal: AbortSignal;
}

export function createProcessAbortHandler(): ProcessAbortHandler {
  const controller = new AbortController();
  const handler = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new AbortError("interrupted"));
    }
    process.off("SIGINT", handler);
  };
  process.on("SIGINT", handler);
  return {
    signal: controller.signal,
    uninstall: () => process.off("SIGINT", handler),
  };
}

let singleton: AbortSignal | null = null;

export function getProcessAbortSignal(): AbortSignal {
  if (singleton === null) {
    singleton = createProcessAbortHandler().signal;
  }
  return singleton;
}

export function combineAborts(
  timeoutSignal: AbortSignal,
  callerSignal?: AbortSignal,
): CombinedAborts {
  const processSignal = getProcessAbortSignal();
  const signals: AbortSignal[] = [timeoutSignal, processSignal];
  if (callerSignal) {
    signals.push(callerSignal);
  }
  return { combined: AbortSignal.any(signals), processSignal };
}

export function throwIfAborted(...signals: Array<AbortSignal | undefined>): void {
  for (const signal of signals) {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
  }
}

export function abortReason(signal: AbortSignal): MetabaseError {
  const reason: unknown = signal.reason;
  if (reason instanceof MetabaseError) {
    return reason;
  }
  if (reason instanceof Error || typeof reason === "string") {
    return new AbortError(errorMessage(reason) || "aborted");
  }
  return new AbortError("aborted");
}
