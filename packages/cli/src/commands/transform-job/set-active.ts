import { z } from "zod";

import { TransformJobActiveResult } from "@metabase/client/domain/transform-job";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

const ActiveWord = z.enum(["true", "false"]);

// The e2e suite drives this command and parses its output against the result schema.
export { TransformJobActiveResult };

const transformJobActiveView: ResourceView<TransformJobActiveResult> = {
  compactPick: TransformJobActiveResult,
  tableColumns: [
    { key: "updated", label: "Updated" },
    { key: "failed", label: "Failed" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "set-active", description: "Activate or deactivate every transform job" },
  details:
    "Flips the active flag on every transform job at once. Inactive jobs do not run on schedule; manual runs ignore the flag. Requires admin.",
  capabilities: { minVersion: 61 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    active: {
      type: "positional",
      description: "true to activate all jobs, false to deactivate",
      required: true,
    },
  },
  outputSchema: TransformJobActiveResult,
  examples: ["mb transform-job set-active false", "mb transform-job set-active true --json"],
  async run({ args, ctx, getClient }) {
    const active = parseEnumFlag(args.active, ActiveWord, "active") === "true";
    const client = await getClient();
    const result = await client.transformJob.setActive(active);
    const label = active ? "Activated" : "Deactivated";
    renderSummary(
      result,
      transformJobActiveView,
      `${label} all transform jobs (${result.updated} updated, ${result.failed} failed).`,
      ctx,
    );
  },
});
