import { LintReport } from "../domain/lint";
import { TimeoutError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

// The server runs the analysis it still owes before it answers, which on a freshly imported
// instance can take many minutes, and it sends nothing until then. Node fails a request whose
// headers take longer than its limit, so each attempt gives up just before it; a resent POST picks
// up the analysis the abandoned one left, until the deadline.
const NODE_HEADERS_TIMEOUT_MS = 300_000;
const ATTEMPT_BUFFER_MS = 10_000;
const ATTEMPT_TIMEOUT_MS = NODE_HEADERS_TIMEOUT_MS - ATTEMPT_BUFFER_MS;
const REPORT_DEADLINE_MS = 30 * 60_000;

export function lintResource(transport: Transport) {
  const { explain } = explainer(transport, "lint");

  // `timeoutMs` is the deadline across every attempt.
  async function report(options: RequestOptions = {}): Promise<LintReport> {
    const deadlineMs = options.timeoutMs ?? REPORT_DEADLINE_MS;
    let spentMs = 0;
    while (true) {
      const attemptMs = Math.min(ATTEMPT_TIMEOUT_MS, deadlineMs - spentMs);
      try {
        return await transport.requestParsed(LintReport, "/api/ee/lint", {
          ...options,
          method: "POST",
          // Safe to resend: the POST only finishes analysis the server would run anyway, then reads.
          idempotent: true,
          // Only a timeout is resent, by this loop, so the transport's retries can't stack on it.
          retries: 0,
          timeoutMs: attemptMs,
        });
      } catch (error) {
        if (!(error instanceof TimeoutError)) {
          throw error;
        }
        spentMs += attemptMs;
        if (spentMs >= deadlineMs) {
          throw new TimeoutError(`Request timed out after ${deadlineMs}ms`, {
            ...error.developerDetail,
            timeoutMs: deadlineMs,
          });
        }
      }
    }
  }

  return { report: explain("report", report) };
}
