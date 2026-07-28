import { AbortError } from "@metabase/client/errors";

import { exitCodeFor } from "../output/error";

const INTERRUPT_REASON = new AbortError("interrupted");

export const INTERRUPT_EXIT_CODE = exitCodeFor(INTERRUPT_REASON.category);

const controller = new AbortController();

// One controller for the whole process: every client request, poll loop and registry lookup
// composes this signal, so N concurrent operations share a single Ctrl-C rather than each
// arranging their own.
export const interruptSignal: AbortSignal = controller.signal;

export function abortOnInterrupt(): void {
  if (!controller.signal.aborted) {
    controller.abort(INTERRUPT_REASON);
  }
}

// How long a command gets to unwind its own abort and report `interrupted` before the process is
// ended for it. Without the deadline a Ctrl-C arriving in a phase that watches no signal — the
// OAuth loopback server, a keyring read — is swallowed, because installing any SIGINT listener
// removes Node's default terminate-on-Ctrl-C.
const FORCED_EXIT_GRACE_MS = 2_000;

// `exit` is the caller's: ending the process belongs to the CLI entry, not to this module.
export function installInterruptHandler(exit: (code: number) => void): void {
  process.on("SIGINT", () => {
    if (interruptSignal.aborted) {
      exit(INTERRUPT_EXIT_CODE);
      return;
    }
    abortOnInterrupt();
    setTimeout(() => exit(INTERRUPT_EXIT_CODE), FORCED_EXIT_GRACE_MS).unref();
  });
}
