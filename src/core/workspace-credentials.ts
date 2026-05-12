import { randomBytes } from "node:crypto";

import { z } from "zod";

import { ConfigError } from "./errors";
import { parseYaml, stringifyYaml } from "../runtime/yaml";

export const API_KEY_NAME = "Workspace API Key";
export const API_KEY_GROUP = "admin";

const PASSWORD_BYTE_LENGTH = 18;
const API_KEY_BYTE_LENGTH = 32;

export const WorkspaceCredentials = z.object({
  workspace_id: z.number().int().positive(),
  user: z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    password: z.string().min(1),
    email: z.string().min(1),
  }),
  api_key: z.object({
    name: z.string().min(1),
    group: z.enum(["admin", "all-users"]),
    creator: z.string().min(1),
    key: z.string().regex(/^mb_[A-Za-z0-9+/=]+$/),
  }),
});
export type WorkspaceCredentials = z.infer<typeof WorkspaceCredentials>;

export function generateWorkspaceCredentials(workspaceId: number): WorkspaceCredentials {
  const email = `workspace-${workspaceId}@workspace.local`;
  return {
    workspace_id: workspaceId,
    user: {
      first_name: "Workspace",
      last_name: "Admin",
      password: randomBase64Url(PASSWORD_BYTE_LENGTH),
      email,
    },
    api_key: {
      name: API_KEY_NAME,
      group: API_KEY_GROUP,
      creator: email,
      key: `mb_${randomBytes(API_KEY_BYTE_LENGTH).toString("base64")}`,
    },
  };
}

const credentialsJsonEncoder = new TextEncoder();

export function buildCredentialsJson(credentials: WorkspaceCredentials): Uint8Array {
  return credentialsJsonEncoder.encode(`${JSON.stringify(credentials, null, 2)}\n`);
}

const ConfigEnvelopeShape = z
  .object({
    version: z.number().int(),
    config: z.looseObject({}),
  })
  .loose();

export function injectCredentialsIntoConfig(
  yamlInput: string,
  credentials: WorkspaceCredentials,
): string {
  const envelope = parseYaml(yamlInput, ConfigEnvelopeShape, { source: "config.yml" });
  if ("users" in envelope.config || "api-keys" in envelope.config) {
    throw new ConfigError(
      "config.yml already declares users or api-keys — refusing to overwrite parent-supplied credentials",
    );
  }
  const merged = {
    ...envelope,
    config: {
      ...envelope.config,
      users: [credentials.user],
      "api-keys": [credentials.api_key],
    },
  };
  return stringifyYaml(merged);
}

export const REPO_SYNC_MODES = ["read-write", "read-only"] as const;
export const RepoSyncMode = z.enum(REPO_SYNC_MODES);
export type RepoSyncMode = z.infer<typeof RepoSyncMode>;

export interface RepoSettings {
  url: string;
  branch: string;
  mode: RepoSyncMode;
}

const ConfigEnvelopeWithSettingsShape = z
  .object({
    version: z.number().int(),
    config: z
      .object({
        settings: z.looseObject({}).optional(),
      })
      .loose(),
  })
  .loose();

const REMOTE_SYNC_KEYS = ["remote-sync-url", "remote-sync-branch", "remote-sync-type"] as const;

export function injectRepoSettingsIntoConfig(yamlInput: string, repo: RepoSettings): string {
  const envelope = parseYaml(yamlInput, ConfigEnvelopeWithSettingsShape, { source: "config.yml" });
  const existingSettings = envelope.config.settings ?? {};
  const conflicts = REMOTE_SYNC_KEYS.filter((key) => key in existingSettings);
  if (conflicts.length > 0) {
    throw new ConfigError(
      `config.yml already declares remote-sync settings (${conflicts.join(", ")}) — refusing to overwrite parent-supplied values`,
    );
  }
  const merged = {
    ...envelope,
    config: {
      ...envelope.config,
      settings: {
        ...existingSettings,
        "remote-sync-url": repo.url,
        "remote-sync-branch": repo.branch,
        "remote-sync-type": repo.mode,
      },
    },
  };
  return stringifyYaml(merged);
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}
