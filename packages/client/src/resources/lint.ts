import { LintReport } from "../domain/lint";
import { TimeoutError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

// The server runs the analysis it still owes before it answers, which on a freshly imported
// instance can take many minutes, and it sends nothing until then. Node fails a request whose
// headers take longer than its limit, so each attempt gives up just before it and the loop resends,
// until the deadline. The server keeps running an abandoned attempt's analysis; the resent POST
// waits for it, then answers.
const NODE_HEADERS_TIMEOUT_MS = 300_000;
const ATTEMPT_BUFFER_MS = 10_000;
const ATTEMPT_TIMEOUT_MS = NODE_HEADERS_TIMEOUT_MS - ATTEMPT_BUFFER_MS;
const REPORT_DEADLINE_MS = 30 * 60_000;

export function lintResource(transport: Transport) {
  const { explain } = explainer(transport, "lint");

  /**
   * Lint the instance's cards, transforms and segments, for an admin. The server first runs the
   * dependency analysis it still owes. `timeoutMs` is the deadline across every attempt; an attempt
   * that times out is resent.
   */
  async function report(options: RequestOptions = {}): Promise<LintReport> {
    const deadlineMs = options.timeoutMs ?? REPORT_DEADLINE_MS;
    const deadlineAt = Date.now() + deadlineMs;
    while (true) {
      const attemptMs = Math.min(ATTEMPT_TIMEOUT_MS, deadlineAt - Date.now());
      try {
        return await transport.requestParsed(LintReport, "/api/ee/lint", {
          ...options,
          method: "POST",
          // Safe to resend: the POST changes nothing but the analysis the server's jobs would run anyway.
          idempotent: true,
          // This loop resends a timeout; transport retries would multiply its attempts. The transport
          // still resends a first try whose connection was closed, which the clock-kept deadline covers.
          retries: 0,
          timeoutMs: attemptMs,
        });
      } catch (error) {
        if (!(error instanceof TimeoutError)) {
          throw error;
        }
        if (Date.now() >= deadlineAt) {
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
