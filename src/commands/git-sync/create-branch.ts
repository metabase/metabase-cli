import { z } from "zod";

import { ConfigError } from "../../core/errors";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

export const CreateBranchResult = z.object({
  status: z.literal("success"),
  message: z.string(),
});
type CreateBranchResult = z.infer<typeof CreateBranchResult>;

const createBranchView: ResourceView<CreateBranchResult> = {
  compactPick: CreateBranchResult,
  tableColumns: [
    { key: "status", label: "Status" },
    { key: "message", label: "Message" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "create-branch",
    description: "Create a new branch on the git remote and switch git-sync to it",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    name: { type: "positional", description: "Branch name", required: true },
  },
  outputSchema: CreateBranchResult,
  examples: [
    "mb git-sync create-branch feat/dashboards",
    "mb git-sync create-branch feat/x --json",
  ],
  async run({ args, ctx, getClient }) {
    const name = args.name.trim();
    if (name === "") {
      throw new ConfigError("invalid name: branch name must not be blank");
    }
    const client = await getClient();
    const result = await client.requestParsed(CreateBranchResult, REMOTE_SYNC_PATHS.createBranch, {
      method: "POST",
      body: { name },
    });
    renderItem(result, createBranchView, ctx);
  },
});
