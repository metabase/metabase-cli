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

export function lintStage(connect: () => Promise<LintStagePort>): CiStage {
  return {
    name: "lint",
    run: async (report) => {
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
