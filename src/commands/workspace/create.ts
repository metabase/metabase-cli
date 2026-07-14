import { z } from "zod";

import { keyringFallbackWarning, setDefaultProfile, writeProfile } from "../../core/auth/storage";
import { readEnvCredentials } from "../../core/config";
import { ENV_API_KEY } from "../../core/env";
import { ConfigError } from "../../core/errors";
import { normalizeUrl } from "../../core/url";
import { Workspace, workspaceView } from "../../domain/workspace";
import { warn } from "../../output/notice";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseIdCsv } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { enforceCredentialSweep, keepExistingAuthFlag } from "./credential-sweep";
import { workspaceProfileName } from "./profile-name";

// The create response when spawn_instance is requested: the workspace plus the spawned
// child's coordinates. The api_key is a secret — it is written to the profile store and
// stripped before anything is rendered; it must never reach stdout or an agent transcript.
const SpawnedWorkspace = Workspace.extend({
  url: z.string().optional(),
  api_key: z.string().optional(),
});

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create and provision a workspace" },
  details:
    "Attaches the given databases and provisions warehouse isolation (a temporary schema + user per database) before returning. Each database must be eligible for workspaces; provisioning is blocking, so the response carries the final per-database status. Before creating, the profile store is swept for broader same-server credentials (any API key, any OAuth grant wider than mb:workspace-manager): interactive runs offer to revoke them, non-interactive runs refuse — --keep-existing-auth is the human-only override. With --spawn the parent also asks its instance manager to spawn a workspace Metabase; the returned credential is saved to the ws-<id> profile (never printed) and made the default, so bare `mb` targets the new workspace.",
  capabilities: { minVersion: 62, tokenFeature: "workspaces" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...keepExistingAuthFlag,
    name: { type: "string", description: "Workspace name", required: true },
    "database-ids": {
      type: "string",
      description: "Database ids to attach, comma separated",
      required: true,
    },
    spawn: {
      type: "boolean",
      description:
        "Spawn a workspace instance and save its credential as the default profile (key is never printed)",
      default: false,
    },
  },
  outputSchema: Workspace,
  examples: [
    "mb workspace create --name ws-reports --database-ids 1",
    "mb workspace create --name ws-etl --database-ids 1,2 --json",
    "mb workspace create --name transform-work --database-ids 1 --spawn",
  ],
  async run({ args, ctx, getClient, getResolvedConfig }) {
    const databaseIds = parseIdCsv(args["database-ids"], "database id");
    if (args.spawn) {
      assertNoApiKeyEnvShadow();
    }
    const resolved = await getResolvedConfig();
    await enforceCredentialSweep({
      url: resolved.url,
      profile: resolved.profile,
      keepExistingAuth: args.keepExistingAuth === true,
      action: "create a workspace",
    });
    const client = await getClient();
    const created = await client.requestParsed(SpawnedWorkspace, "/api/ee/workspace-manager/", {
      method: "POST",
      body: {
        name: args.name,
        database_ids: databaseIds,
        spawn_instance: args.spawn ? true : undefined,
      },
    });
    if (args.spawn) {
      await saveSpawnedCredential(created);
    }
    const workspace = { ...created };
    delete workspace.api_key;
    renderSummary(
      workspace,
      workspaceView,
      `Created workspace ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

// An exported MB_API_KEY outranks stored profiles in credential resolution, so it would
// silently shadow the workspace default profile this command is about to install — bare
// `mb` would keep hitting whatever the env key points at. Same guard as `auth login --workspace`.
function assertNoApiKeyEnvShadow(): void {
  if (readEnvCredentials().apiKey !== null) {
    throw new ConfigError(
      `--spawn saves the workspace credential as the default profile, but ${ENV_API_KEY} is set and would shadow it — unset ${ENV_API_KEY} first`,
    );
  }
}

type SpawnedWorkspaceResponse = z.infer<typeof SpawnedWorkspace>;

async function saveSpawnedCredential(created: SpawnedWorkspaceResponse): Promise<void> {
  if (created.url === undefined || created.api_key === undefined) {
    throw new Error(
      "the server did not return a spawned instance (no url/api_key in the create response) — this Metabase may not support spawn_instance",
    );
  }
  const profileName = workspaceProfileName(created.id);
  const location = await writeProfile(
    { url: normalizeUrl(created.url), apiKey: created.api_key },
    profileName,
  );
  if (location.backend === "file") {
    warn(keyringFallbackWarning(location));
  }
  await setDefaultProfile(profileName);
  warn(
    `saved workspace credential to profile "${profileName}" and made it the default — bare \`mb\` now targets ${created.url}`,
  );
}
