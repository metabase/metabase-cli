import { TransformJobRunResult } from "@metabase/client/domain/transform-job";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

// The e2e suite drives this command and parses its output against the result schema.
export { TransformJobRunResult };
export type TransformJobRunResultJson = TransformJobRunResult;

const transformJobRunResultView: ResourceView<TransformJobRunResultJson> = {
  compactPick: TransformJobRunResult,
  tableColumns: [
    { key: "started", label: "Started" },
    { key: "run_id", label: "Run" },
    { key: "message", label: "Message" },
  ],
};

function runSummary(id: number, result: TransformJobRunResult): string {
  if (result.started === null) {
    return `Requested a run of transform job ${id}; this server does not say whether one started.`;
  }
  if (!result.started) {
    return `Transform job ${id} was not started (already running, or it resolves to no transforms).`;
  }
  if (result.run_id === null) {
    return `Started transform job ${id}.`;
  }
  return `Started transform job ${id} as run ${result.run_id}.`;
}

export default defineMetabaseCommand({
  meta: { name: "run", description: "Trigger a transform job run by id" },
  details:
    "Starts the job and returns immediately. The job runs every transform carrying one of its tags, plus those transforms' dependencies. Dependencies that are already fresh are skipped by default; --force-refresh re-runs the whole plan including them.",
  requires: ["transformJob.run"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    "force-refresh": {
      type: "boolean",
      description: "Re-run the whole plan, including dependencies that are already fresh",
      default: false,
    },
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJobRunResult,
  examples: ["mb transform-job run 1", "mb transform-job run 1 --force-refresh --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const result = await client.transformJob.run(id, { run_all: args["force-refresh"] === true });
    renderSummary(result, transformJobRunResultView, runSummary(id, result), ctx);
  },
});
