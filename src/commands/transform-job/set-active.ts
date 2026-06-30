import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

const ActiveWord = z.enum(["true", "false"]);

export const TransformJobActiveResult = z.object({
  updated: z.number().int(),
  failed: z.number().int(),
});
export type TransformJobActiveResultJson = z.infer<typeof TransformJobActiveResult>;

const transformJobActiveView: ResourceView<TransformJobActiveResultJson> = {
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
    const result = await client.requestParsed(
      TransformJobActiveResult,
      "/api/transform-job/active",
      {
        method: "PUT",
        body: { active },
      },
    );
    const label = active ? "Activated" : "Deactivated";
    renderSummary(
      result,
      transformJobActiveView,
      `${label} all transform jobs (${result.updated} updated, ${result.failed} failed).`,
      ctx,
    );
  },
});
