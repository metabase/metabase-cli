import { isTransformRunFailed, TransformRunResult } from "@metabase/client/domain/transform";

import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { parseWaitFlags, waitFlags } from "../wait-flags";

const transformRunResultView: ResourceView<TransformRunResult> = {
  compactPick: TransformRunResult,
  tableColumns: [
    { key: "run_id", label: "Run ID" },
    { key: "message", label: "Message" },
    { key: "target_table_id", label: "Target table" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "run", description: "Trigger a transform run by id" },
  details:
    "Starts a run and returns immediately. --wait polls the run to a terminal status. --sync additionally waits until the run's output table is registered and returns its `target_table_id`, so you can build MBQL cards against it — the run registers the table itself, so no separate `db sync-schema` is needed; --sync implies waiting for the run.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...waitFlags,
    sync: {
      type: "boolean",
      description:
        "After a successful run, wait until the output table is registered and return its id (implies --wait)",
      default: false,
    },
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformRunResult,
  examples: [
    "mb transform run 1",
    "mb transform run 1 --wait --json",
    "mb transform run 1 --sync --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const syncTarget = args.sync === true;
    const wait = parseWaitFlags(args);
    const waitForRun = wait.enabled || syncTarget;
    const client = await getClient();
    const result = await client.transform.run(id, {
      ...(waitForRun && { wait: wait.schedule }),
      syncTarget,
    });

    if (!waitForRun) {
      const started =
        result.run_id === null
          ? result.message
          : `Started run ${result.run_id} for transform ${id}.`;
      renderSummary(result, transformRunResultView, started, ctx);
      return;
    }

    // Waiting was asked for, so the absence of a run to report on means none was started.
    if (result.run_id === null || result.final === null) {
      renderSummary(result, transformRunResultView, result.message, ctx);
      throw new Error(`transform run did not start: ${result.message}`);
    }

    const status = result.final.status;
    renderSummary(
      result,
      transformRunResultView,
      summaryLine(id, result.run_id, status, syncTarget, result.target_table_id),
      ctx,
    );

    if (isTransformRunFailed(status)) {
      throw new Error(`transform run ${result.run_id} ${status}`);
    }
  },
});

function summaryLine(
  transformId: number,
  runId: number,
  status: string,
  syncTarget: boolean,
  targetTableId: number | null | undefined,
): string {
  const base = `Run ${runId} of transform ${transformId} ${status}.`;
  if (!syncTarget) {
    return base;
  }
  return targetTableId === null || targetTableId === undefined
    ? `${base} Output table not registered before the wait timeout (it may still be syncing).`
    : `${base} Output table ${targetTableId} registered.`;
}
