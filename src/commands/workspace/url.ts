import { z } from "zod";

import { checkDockerReady, containerNameFor, inspectWorkspaceContainer } from "../../core/docker";
import { ConfigError } from "../../core/errors";
import { localUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const UrlResult = z.object({
  workspace_id: z.number().int().positive(),
  url: z.string(),
});
export type UrlResult = z.infer<typeof UrlResult>;

const urlResultView: ResourceView<UrlResult> = {
  compactPick: UrlResult.pick({ workspace_id: true, url: true }).strip(),
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "url", label: "URL" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "url",
    description: "Print the local URL the workspace's container is bound to",
  },
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: UrlResult,
  examples: ["metabase workspace url 1", "metabase workspace url 1 --json"],
  async run({ args, ctx }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);

    await checkDockerReady();
    const summary = await inspectWorkspaceContainer(containerName);
    if (summary === null) {
      throw new ConfigError(
        `no container for workspace ${workspaceId} — run \`metabase workspace start ${workspaceId}\` first`,
      );
    }
    if (summary.hostPort === null) {
      throw new ConfigError(
        `container ${containerName} is missing the host-port label — likely created by a different tool`,
      );
    }

    const result: UrlResult = {
      workspace_id: workspaceId,
      url: localUrl(summary.hostPort),
    };
    renderItem(result, urlResultView, ctx);
  },
});
