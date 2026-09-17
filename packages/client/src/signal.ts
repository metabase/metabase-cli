import { AbortError, errorMessage, MetabaseError } from "./errors";

export function combineAborts(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal) => signal !== undefined));
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

// Settles as `promise` does, or rejects with the signal's reason first. The promise keeps running:
// this abandons a wait, never the work behind it.
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
