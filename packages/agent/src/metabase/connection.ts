import { type Client, createClient } from "@metabase/cli/client";
import { type ConfigFlags, createCredentialRefresher, resolveConfig } from "@metabase/cli/config";
import { ConfigError } from "@metabase/cli/errors";
import { displayUrl } from "@metabase/cli/url";
import { useAgentProfileStore } from "../auth/store";

export interface MetabaseConnection {
  client: Client;
  url: string;
  profile: string;
}

// Auth resolution is the CLI's — flag → env → the profile's stored credential (OS keychain, browser
// login included) — run against the agent's own profile store. Same resolver, same profile format,
// same login flow, a vault of its own: `mb auth login` at a terminal cannot authenticate the agent,
// and `mb-agent auth login` cannot touch the credential a human uses from the shell.
export async function createMetabaseConnection(
  flags: ConfigFlags = {},
): Promise<MetabaseConnection> {
  useAgentProfileStore();
  const config = await resolveConfig(flags);
  const client = createClient(
    { url: config.url, credential: config.credential },
    { refreshCredential: createCredentialRefresher(config.profile) },
  );
  return { client, url: displayUrl(config.url), profile: config.profile };
}

// `null` when no credential is configured at all. `chat` opens anyway and `/mb-login` establishes
// one; a headless `run` has nowhere to sign in, so it lets the ConfigError out.
export async function tryMetabaseConnection(
  flags: ConfigFlags = {},
): Promise<MetabaseConnection | null> {
  try {
    return await createMetabaseConnection(flags);
  } catch (error) {
    if (error instanceof ConfigError) {
      return null;
    }
    throw error;
  }
}
