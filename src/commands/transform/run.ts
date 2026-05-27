import { z } from "zod";

import { TimeoutError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { Transform, TransformRun } from "../../domain/transform";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { pollUntil } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { parseWaitFlags, waitFlags, type WaitSchedule } from "../wait-flags";

export const RUN_TERMINAL_STATUSES = new Set(["succeeded", "failed", "timeout", "canceled"]);
const RUN_FAILURE_STATUSES = new Set(["failed", "timeout", "canceled"]);

const TransformRunKickoff = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
});

export const TransformRunResult = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
  final: TransformRun.nullable(),
  target_table_id: z.number().int().nullable().optional(),
});
export type TransformRunResultJson = z.infer<typeof TransformRunResult>;

const transformRunResultView: ResourceView<TransformRunResultJson> = {
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
    const kickoff = await client.requestParsed(TransformRunKickoff, `/api/transform/${id}/run`, {
      method: "POST",
    });

    if (!waitForRun) {
      const started =
        kickoff.run_id === null
          ? kickoff.message
          : `Started run ${kickoff.run_id} for transform ${id}.`;
      renderSummary(
        { message: kickoff.message, run_id: kickoff.run_id, final: null },
        transformRunResultView,
        started,
        ctx,
      );
      return;
    }

    if (kickoff.run_id === null) {
      renderSummary(
        { message: kickoff.message, run_id: null, final: null },
        transformRunResultView,
        kickoff.message,
        ctx,
      );
      throw new Error(`transform run did not start: ${kickoff.message}`);
    }

    const runId = kickoff.run_id;

    const final = await pollUntil(
      async () => client.requestParsed(TransformRun, `/api/transform/run/${runId}`),
      (run) => RUN_TERMINAL_STATUSES.has(run.status),
      wait.schedule,
    );

    const failed = RUN_FAILURE_STATUSES.has(final.status);
    const targetTableId =
      syncTarget && !failed ? await awaitTargetTableId(client, id, wait.schedule) : undefined;

    const result: TransformRunResultJson = { message: kickoff.message, run_id: runId, final };
    if (syncTarget) {
      result.target_table_id = targetTableId ?? null;
    }

    renderSummary(
      result,
      transformRunResultView,
      summaryLine(id, runId, final.status, syncTarget, targetTableId),
      ctx,
    );

    if (failed) {
      throw new Error(`transform run ${runId} ${final.status}`);
    }
  },
});

// A successful run registers its own output table — Metabase syncs the single materialized
// table as part of run completion, so no explicit db sync is needed here. The linkage surfaces
// as `target_table_id` on v61+ and as the hydrated `table.id` on v59/v60; poll until either
// lands. Returns null on poll timeout (the table is still syncing) rather than failing the run.
async function awaitTargetTableId(
  client: Client,
  transformId: number,
  schedule: WaitSchedule,
): Promise<number | null> {
  try {
    const linked = await pollUntil(
      async () => client.requestParsed(Transform, `/api/transform/${transformId}`),
      (transform) => linkedTableId(transform) !== null,
      schedule,
    );
    return linkedTableId(linked);
  } catch (error) {
    if (error instanceof TimeoutError) {
      return null;
    }
    throw error;
  }
}

function linkedTableId(transform: Transform): number | null {
  return transform.target_table_id ?? transform.table?.id ?? null;
}

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
