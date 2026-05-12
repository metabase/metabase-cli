import { z } from "zod";

import {
  checkDockerReady,
  readContainerCredentialsFile,
  requireWorkspaceContainerLocation,
} from "../../core/docker";
import { localUrl } from "../../core/url";
import { WorkspaceCredentials } from "../../core/workspace-credentials";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { parseJson } from "../../runtime/json";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const WorkspaceCredentialsResult = z.object({
  workspace_id: z.number().int().positive(),
  url: z.string(),
  email: z.string(),
  password: z.string(),
  api_key_name: z.string(),
  api_key: z.string(),
});
export type WorkspaceCredentialsResult = z.infer<typeof WorkspaceCredentialsResult>;

const credentialsView: ResourceView<WorkspaceCredentialsResult> = {
  compactPick: WorkspaceCredentialsResult,
  tableColumns: [
    { key: "workspace_id", label: "ID" },
    { key: "url", label: "URL" },
    { key: "email", label: "Email" },
    { key: "password", label: "Password" },
    { key: "api_key_name", label: "API Key Name" },
    { key: "api_key", label: "API Key" },
  ],
};

const textDecoder = new TextDecoder("utf-8");

export default defineMetabaseCommand({
  meta: {
    name: "credentials",
    description:
      "Read the workspace child instance's admin credentials (email + password + API key) from the running container",
  },
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: WorkspaceCredentialsResult,
  examples: ["metabase workspace credentials 1", "metabase workspace credentials 1 --json"],
  async run({ args, ctx }) {
    const workspaceId = parseId(args.id);

    await checkDockerReady();
    const { containerName, hostPort } = await requireWorkspaceContainerLocation(workspaceId);

    const bytes = await readContainerCredentialsFile(workspaceId);
    const credentials = parseJson(textDecoder.decode(bytes), WorkspaceCredentials, {
      source: `${containerName}:credentials.json`,
    });

    const result: WorkspaceCredentialsResult = {
      workspace_id: workspaceId,
      url: localUrl(hostPort),
      email: credentials.user.email,
      password: credentials.user.password,
      api_key_name: credentials.api_key.name,
      api_key: credentials.api_key.key,
    };
    renderItem(result, credentialsView, ctx);
  },
});
