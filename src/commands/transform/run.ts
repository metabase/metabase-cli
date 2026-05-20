import { z } from "zod";

import { TransformRun } from "../../domain/transform";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { pollUntil } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { parseWaitFlags, waitFlags } from "../wait-flags";

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
});
export type TransformRunResultJson = z.infer<typeof TransformRunResult>;

const transformRunResultView: ResourceView<TransformRunResultJson> = {
  compactPick: TransformRunResult,
  tableColumns: [
    { key: "run_id", label: "Run ID" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "run", description: "Trigger a transform run by id" },
  capabilities: { minVersion: 58, edition: "ee", tokenFeature: "transforms" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...waitFlags,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformRunResult,
  examples: ["mb transform run 1", "mb transform run 1 --wait --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const wait = parseWaitFlags(args);
    const client = await getClient();
    const kickoff = await client.requestParsed(TransformRunKickoff, `/api/transform/${id}/run`, {
      method: "POST",
    });

    if (!wait.enabled) {
      renderItem(
        { message: kickoff.message, run_id: kickoff.run_id, final: null },
        transformRunResultView,
        ctx,
      );
      return;
    }

    if (kickoff.run_id === null) {
      renderItem(
        { message: kickoff.message, run_id: null, final: null },
        transformRunResultView,
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

    renderItem({ message: kickoff.message, run_id: runId, final }, transformRunResultView, ctx);

    if (RUN_FAILURE_STATUSES.has(final.status)) {
      throw new Error(`transform run ${runId} ${final.status}`);
    }
  },
});
