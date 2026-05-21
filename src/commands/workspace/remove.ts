import { z } from "zod";

import {
  checkDockerReady,
  containerNameFor,
  removeContainer,
  removeVolume,
  volumeNameFor,
} from "../../core/docker";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { promptConfirm } from "../../output/prompt";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const RemoveResult = z.object({
  workspace_id: z.number().int().positive(),
  container_name: z.string(),
  volume_name: z.string(),
  removed_container: z.boolean(),
  removed_volume: z.boolean(),
});
export type RemoveResult = z.infer<typeof RemoveResult>;

const removeResultView: ResourceView<RemoveResult> = {
  compactPick: RemoveResult.pick({
    workspace_id: true,
    removed_container: true,
    removed_volume: true,
  }).strip(),
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "container_name", label: "Container" },
    { key: "volume_name", label: "Volume" },
    { key: "removed_container", label: "Removed Container" },
    { key: "removed_volume", label: "Removed Volume" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "remove",
    description: "Stop and remove the local container + app-db volume (does not affect remote)",
  },
  capabilities: null,
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
    "keep-volume": {
      type: "boolean",
      description: "Keep the workspace's app-db volume (faster restart, app-db survives)",
      default: false,
    },
    yes: { type: "boolean", description: "Skip the confirmation prompt", default: false },
  },
  outputSchema: RemoveResult,
  examples: ["mb workspace remove 1 --yes", "mb workspace remove 1 --keep-volume --yes"],
  async run({ args, ctx }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);
    const volumeName = volumeNameFor(workspaceId);
    const shouldRemoveVolume = args["keep-volume"] !== true;

    await checkDockerReady();

    if (!args.yes && process.stdin.isTTY === true) {
      const confirmed = await promptConfirm({
        message: shouldRemoveVolume
          ? `Remove container ${containerName} and its app-db volume ${volumeName}?`
          : `Remove container ${containerName}? (volume ${volumeName} will be kept)`,
      });
      if (!confirmed) {
        return;
      }
    }

    const removedContainer = await removeContainer(containerName);
    const removedVolume = shouldRemoveVolume ? await removeVolume(volumeName) : false;

    const result: RemoveResult = {
      workspace_id: workspaceId,
      container_name: containerName,
      volume_name: volumeName,
      removed_container: removedContainer,
      removed_volume: removedVolume,
    };
    renderItem(result, removeResultView, ctx);
  },
});
