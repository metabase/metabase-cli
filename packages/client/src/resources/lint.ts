import { LintReport } from "../domain/lint";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

// The server runs the analysis it still owes before it answers, which on a freshly imported
// instance can take a while; the default request timeout is sized for a lookup.
const REPORT_TIMEOUT_MS = 10 * 60_000;

export function lintResource(transport: Transport) {
  const { explain } = explainer(transport, "lint");

  /**
   * The lint report of the whole instance, for superusers: every card, transform and segment whose
   * query analysis found an error, as one result per error naming the rule, the entity by its
   * serialization `entity_id`, and the entity that caused it when the analysis traced one. The
   * server finishes the analysis it owes before answering, so `passed` means nothing is broken.
   */
  async function report(options: RequestOptions = {}): Promise<LintReport> {
    return transport.requestParsed(LintReport, "/api/ee/lint", {
      timeoutMs: REPORT_TIMEOUT_MS,
      ...options,
    });
  }

  return { report: explain("report", report) };
}
