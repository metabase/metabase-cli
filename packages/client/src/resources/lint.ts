import { LintReport } from "../domain/lint";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

// The server runs the analysis it still owes before it answers, which on a freshly imported
// instance can take a while; the default request timeout is sized for a lookup.
const REPORT_TIMEOUT_MS = 10 * 60_000;

export function lintResource(transport: Transport) {
  const { explain } = explainer(transport, "lint");

  async function report(options: RequestOptions = {}): Promise<LintReport> {
    return transport.requestParsed(LintReport, "/api/ee/lint", {
      ...options,
      method: "POST",
      timeoutMs: options.timeoutMs ?? REPORT_TIMEOUT_MS,
    });
  }

  return { report: explain("report", report) };
}
