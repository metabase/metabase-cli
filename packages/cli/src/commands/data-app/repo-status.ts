import { DataAppRepoStatus } from "@metabase/client/domain/data-app";
import type { ResourceView } from "../../output/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const repoStatusView: ResourceView<DataAppRepoStatus> = {
  compactPick: DataAppRepoStatus,
  tableColumns: [
    { key: "configured", label: "Configured" },
    { key: "url", label: "URL" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "repo-status", description: "Show the repository git sync serves data apps from" },
  details:
    "Admin only. `configured: false` means no repository is connected, so apps can only be pushed through the API.",
  skills: [{ skill: "git-sync", purpose: "connect the repository data apps are served from" }],
  requires: ["dataApp.repoStatus"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: DataAppRepoStatus,
  examples: ["mb data-app repo-status", "mb data-app repo-status --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    renderItem(await client.dataApp.repoStatus(), repoStatusView, ctx);
  },
});
