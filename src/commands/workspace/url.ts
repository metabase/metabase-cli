import { z } from "zod";

import { checkDockerReady, requireWorkspaceContainerLocation } from "../../core/docker";
import { localUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const UrlResult = z.object({
  workspace_id: z.number().int().positive(),
  url: z.string(),
});
export type UrlResult = z.infer<typeof UrlResult>;

const urlResultView: ResourceView<UrlResult> = {
  compactPick: UrlResult,
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
  capabilities: null,
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: UrlResult,
  examples: ["mb workspace url 1", "mb workspace url 1 --json"],
  async run({ args, ctx }) {
    const workspaceId = parseId(args.id);

    await checkDockerReady();
    const { hostPort } = await requireWorkspaceContainerLocation(workspaceId);

    const result: UrlResult = {
      workspace_id: workspaceId,
      url: localUrl(hostPort),
    };
    renderSummary(result, urlResultView, result.url, ctx);
  },
});
