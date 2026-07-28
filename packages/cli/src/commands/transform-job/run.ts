import { TransformJobRunResult } from "@metabase/client/domain/transform-job";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

// The e2e suite drives this command and parses its output against the result schema.
export { TransformJobRunResult };
export type TransformJobRunResultJson = TransformJobRunResult;

const transformJobRunResultView: ResourceView<TransformJobRunResultJson> = {
  compactPick: TransformJobRunResult,
  tableColumns: [
    { key: "job_run_id", label: "Job run" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "run", description: "Trigger a transform job run by id" },
  details:
    "Starts the job and returns immediately. The job runs every transform carrying one of its tags, plus those transforms' dependencies. Dependencies that are already fresh are skipped by default; --force-refresh re-runs the whole plan including them.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
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
    const summary =
      result.job_run_id === null
        ? `Transform job ${id} was not started (already running, or it resolves to no transforms).`
        : `Started transform job ${id}.`;
    renderSummary(result, transformJobRunResultView, summary, ctx);
  },
});
