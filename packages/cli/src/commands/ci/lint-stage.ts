import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import type { LintReport } from "@metabase/client/domain/lint";

import { brokenRefChecks, reportStop } from "../../core/ci-broken-refs";
import type { CiStage } from "../../core/ci-events";
import { interruptSignal } from "../../runtime/interrupt";

export interface LintStagePort {
  readReport: () => Promise<LintReport>;
  nowMs: () => number;
}

export function lintPort(client: MetabaseClient): LintStagePort {
  return {
    readReport: () => client.lint.report({ signal: interruptSignal }),
    nowMs: () => performance.now(),
  };
}

// The coverage checks, which need no server, then the instance's saved queries. The stage connects
// only once coverage has reported.
export function lintStage(coverage: CiStage, connect: () => Promise<LintStagePort>): CiStage {
  return {
    name: coverage.name,
    run: async (report) => {
      const stopped = await coverage.run(report);
      if (stopped !== null) {
        return stopped;
      }
      try {
        const port = await connect();
        const started = port.nowMs();
        const lintReport = await port.readReport();
        for (const check of brokenRefChecks(lintReport, port.nowMs() - started)) {
          report(check);
        }
        return null;
      } catch (error) {
        const stop = reportStop(error);
        if (stop === null) {
          throw error;
        }
        return stop;
      }
    },
  };
}
