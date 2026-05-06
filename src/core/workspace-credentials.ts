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

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}
