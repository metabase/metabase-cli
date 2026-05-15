import { z } from "zod";

import {
  CONTAINER_STATES,
  checkDockerReady,
  listWorkspaceContainers,
  type ContainerState,
} from "../../core/docker";
import { localUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const LocalWorkspaceState = z.enum(CONTAINER_STATES);
export type LocalWorkspaceState = ContainerState;

export const LocalWorkspace = z.object({
  workspace_id: z.number().int().positive(),
  workspace_name: z.string(),
  container_name: z.string(),
  state: LocalWorkspaceState,
  status: z.string(),
  image: z.string(),
  profile: z.string().nullable(),
  parent_url: z.string().nullable(),
  host_port: z.number().int().positive().nullable(),
  url: z.string().nullable(),
});
export type LocalWorkspace = z.infer<typeof LocalWorkspace>;

export const LocalWorkspaceCompact = LocalWorkspace.pick({
  workspace_id: true,
  workspace_name: true,
  state: true,
  url: true,
}).strip();
export type LocalWorkspaceCompact = z.infer<typeof LocalWorkspaceCompact>;

export const localWorkspaceView: ResourceView<LocalWorkspace> = {
  compactPick: LocalWorkspaceCompact,
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "workspace_name", label: "Name" },
    { key: "state", label: "State" },
    { key: "url", label: "URL", format: (value) => (typeof value === "string" ? value : "—") },
  ],
};

export const LocalWorkspaceListEnvelope = listEnvelopeSchema(LocalWorkspaceCompact);

export default defineMetabaseCommand({
  meta: {
    name: "ps",
    description: "List workspaces with a local container (running or stopped)",
  },
  args: { ...outputFlags },
  outputSchema: LocalWorkspaceListEnvelope,
  examples: ["mb workspace ps", "mb workspace ps --json"],
  async run({ ctx }) {
    await checkDockerReady();
    const summaries = await listWorkspaceContainers();
    const items: LocalWorkspace[] = summaries.map((summary) => ({
      workspace_id: summary.workspaceId,
      workspace_name: summary.workspaceName,
      container_name: summary.name,
      state: summary.state,
      status: summary.status,
      image: summary.image,
      profile: summary.profile,
      parent_url: summary.parentUrl,
      host_port: summary.hostPort,
      url:
        summary.hostPort !== null && summary.state === "running"
          ? localUrl(summary.hostPort)
          : null,
    }));
    items.sort((a, b) => a.workspace_id - b.workspace_id);
    renderList(wrapList(items), localWorkspaceView, ctx);
  },
});
