import { spawn } from "node:child_process";
import { ENV_PROFILE_STORE } from "@metabase/cli/config";
import { resolveCliScript } from "./cli-binary";
import { AGENT_PROFILE_STORE } from "./store";

const EXIT_ERROR = 1;

// `mb-agent auth …` is the CLI's `auth`, pointed at the agent's profile store. Browser (OAuth) login,
// API-key login, the profile list, logout and status are the CLI's — one implementation of the login
// flow, one profile format, two stores. Reimplementing PKCE and a callback server here would buy
// isolation we already have.
export async function runAgentAuth(args: string[]): Promise<number> {
  return await spawnCliAuth(await resolveCliScript(), args);
}

// Run through this process's own node, so the child does not depend on an executable bit the package
// manager may not have set on the CLI's entry script.
function spawnCliAuth(script: string, args: string[]): Promise<number> {
  const child = spawn(process.execPath, [script, "auth", ...args], {
    stdio: "inherit",
    env: { ...process.env, [ENV_PROFILE_STORE]: AGENT_PROFILE_STORE },
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    // A signal-killed child reports a null code; the agent still has to exit with a number.
    child.on("close", (code) => resolve(code ?? EXIT_ERROR));
  });
}
