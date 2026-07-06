import { z } from "zod";

import { ConfigError } from "../../core/errors";
import type { ResourceView } from "../../domain/view";
import { promptConfirm } from "../../output/prompt";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const WorkspaceOrphanedResource = z
  .object({
    workspace_database_id: z.number().int(),
    database_id: z.number().int(),
    driver: z.string(),
    schema: z.string(),
    user: z.string(),
    reason: z.string().nullable().optional(),
  })
  .loose();

const WorkspaceDeleteResponse = z
  .object({
    id: z.number().int(),
    deleted: z.boolean(),
    message: z.string().optional(),
    orphaned_resources: z.array(WorkspaceOrphanedResource).optional(),
  })
  .loose();

export const WorkspaceDestroyResult = WorkspaceDeleteResponse.extend({
  aborted: z.boolean(),
});
export type WorkspaceDestroyResultJson = z.infer<typeof WorkspaceDestroyResult>;

const workspaceDestroyView: ResourceView<WorkspaceDestroyResultJson> = {
  compactPick: WorkspaceDestroyResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "deleted", label: "Destroyed" },
    { key: "aborted", label: "Aborted" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "destroy", description: "Destroy a workspace and its warehouse isolation" },
  details:
    "Tears down each provisioned database's warehouse isolation (temporary schema + user) before removing the workspace. Refuses with a 409 while any database is still provisioning/deprovisioning unless --ignore-pending is passed, which removes the workspace records and leaves those warehouse objects behind. If the warehouse was unreachable, the result lists the leftover schema/user objects under orphaned_resources.",
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    "ignore-pending": {
      type: "boolean",
      description: "Remove workspace records even while databases are provisioning/deprovisioning",
      default: false,
    },
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: WorkspaceDestroyResult,
  examples: ["mb workspace destroy 1 --yes", "mb workspace destroy 1 --yes --ignore-pending"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    if (!args.yes) {
      if (process.stdin.isTTY !== true) {
        throw new ConfigError(
          `refusing to destroy workspace ${id} without confirmation — pass --yes to proceed non-interactively`,
        );
      }
      const ok = await promptConfirm({
        message: `Destroy workspace ${id}? Its warehouse isolation (schema + user) is dropped.`,
        initialValue: false,
      });
      if (!ok) {
        renderSummary(
          { id, deleted: false, aborted: true },
          workspaceDestroyView,
          `Aborted; workspace ${id} was not destroyed.`,
          ctx,
        );
        return;
      }
    }
    const client = await getClient();
    const response = await client.requestParsed(
      WorkspaceDeleteResponse,
      `/api/ee/workspace-manager/${id}`,
      {
        method: "DELETE",
        query: { "ignore-pending": args["ignore-pending"] ? true : undefined },
      },
    );
    renderSummary(
      { ...response, aborted: false },
      workspaceDestroyView,
      response.message ?? `Destroyed workspace ${id}.`,
      ctx,
    );
  },
});
