import { ENV_PROFILE_STORE, keyringService } from "@metabase/cli/config";

// mb-agent is installed, published and authenticated separately from `mb`. Its Metabase credentials
// use the CLI's profile format and the CLI's login flow, but live in their own store: neither
// product can read, refresh, overwrite or clear the other's, so an agent run never acts under the
// credential a human logged the terminal in with.
export const AGENT_PROFILE_STORE = "agent";

// The keychain service holding the agent's profiles (`profile:<name>:…`) and, alongside them, the
// model provider blob pi stores.
export const AGENT_KEYRING_SERVICE = keyringService(AGENT_PROFILE_STORE);

// Set before any credential is resolved, and inherited by every `mb` the model runs.
export function useAgentProfileStore(): void {
  process.env[ENV_PROFILE_STORE] = AGENT_PROFILE_STORE;
}
