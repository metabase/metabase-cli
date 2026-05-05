import { z } from "zod";

import { TransformRun } from "../../domain/transform";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { pollUntil } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const RUN_TERMINAL_STATUSES = new Set(["succeeded", "failed", "timeout", "canceled"]);
const RUN_FAILURE_STATUSES = new Set(["failed", "timeout", "canceled"]);

const DEFAULT_WAIT_TIMEOUT_MS = 600_000;
const DEFAULT_WAIT_INTERVAL_MS = 2_000;

const TransformRunKickoff = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
});

export const TransformRunResult = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
  final: TransformRun.nullable().optional(),
});
export type TransformRunResultJson = z.infer<typeof TransformRunResult>;

const transformRunView: ResourceView<TransformRunResultJson> = {
  compactPick: TransformRunResult,
  tableColumns: [
    { key: "run_id", label: "Run ID" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "run", description: "Trigger a transform run by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    wait: {
      type: "boolean",
      description: "Poll until the run reaches a terminal status",
      default: false,
    },
    timeout: {
      type: "string",
      description: "Polling timeout in ms (used with --wait)",
      default: String(DEFAULT_WAIT_TIMEOUT_MS),
    },
    interval: {
      type: "string",
      description: "Polling interval in ms (used with --wait)",
      default: String(DEFAULT_WAIT_INTERVAL_MS),
    },
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformRunResult,
  examples: ["metabase transform run 1", "metabase transform run 1 --wait --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const kickoff = await client.requestParsed(TransformRunKickoff, `/api/transform/${id}/run`, {
      method: "POST",
    });

    if (!args.wait || kickoff.run_id === null) {
      renderItem({ message: kickoff.message, run_id: kickoff.run_id }, transformRunView, ctx);
      return;
    }

    const intervalMs = parseId(args.interval, "interval");
    const timeoutMs = parseId(args.timeout, "timeout");
    const runId = kickoff.run_id;

    const final = await pollUntil(
      async () => client.requestParsed(TransformRun, `/api/transform/run/${runId}`),
      (run) => RUN_TERMINAL_STATUSES.has(run.status),
      { intervalMs, timeoutMs },
    );

    renderItem({ message: kickoff.message, run_id: runId, final }, transformRunView, ctx);

    if (RUN_FAILURE_STATUSES.has(final.status)) {
      const detail = final.message ? `: ${final.message}` : "";
      throw new Error(`transform run ${runId} ${final.status}${detail}`);
    }
  },
});
