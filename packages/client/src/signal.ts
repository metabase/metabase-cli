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
