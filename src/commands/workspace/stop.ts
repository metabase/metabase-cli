import { z } from "zod";

import {
  checkDockerReady,
  containerLifecycleStatus,
  containerNameFor,
  stopContainer,
} from "../../core/docker";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { LocalWorkspaceState } from "./ps";

export const StopResult = z.object({
  workspace_id: z.number().int().positive(),
  container_name: z.string(),
  stopped: z.boolean(),
  prior_state: LocalWorkspaceState.nullable(),
});
export type StopResult = z.infer<typeof StopResult>;

const stopResultView: ResourceView<StopResult> = {
  compactPick: StopResult.pick({
    workspace_id: true,
    stopped: true,
    prior_state: true,
  }).strip(),
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "container_name", label: "Container" },
    { key: "stopped", label: "Stopped" },
    { key: "prior_state", label: "Prior State" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "stop",
    description: "Stop the local Docker container for a workspace (does not remove it)",
  },
  capabilities: null,
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: StopResult,
  examples: ["mb workspace stop 1", "mb workspace stop 1 --json"],
  async run({ args, ctx }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);

    await checkDockerReady();
    const status = await containerLifecycleStatus(containerName);
    const priorState = status === "missing" ? null : status;

    let stopped = false;
    if (status === "running") {
      await stopContainer(containerName);
      stopped = true;
    }

    const result: StopResult = {
      workspace_id: workspaceId,
      container_name: containerName,
      stopped,
      prior_state: priorState,
    };
    let message: string;
    if (result.stopped) {
      message = `Stopped workspace ${workspaceId} (container ${containerName}).`;
    } else if (result.prior_state !== null) {
      message = `Workspace ${workspaceId} container is already ${result.prior_state} — nothing to stop.`;
    } else {
      message = `No container found for workspace ${workspaceId} — nothing to stop.`;
    }
    renderSummary(result, stopResultView, message, ctx);
  },
});
