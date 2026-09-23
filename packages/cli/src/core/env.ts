export const ENV_URL = "MB_URL";
export const ENV_API_KEY = "MB_API_KEY";
export const ENV_AUTH_BROKER = "MB_AUTH_BROKER";
export const ENV_AUTH_BROKER_TOKEN = "MB_AUTH_BROKER_TOKEN";
export const ENV_WORKTREE_ID = "MB_WORKTREE_ID";
export const ENV_VERBOSE = "MB_VERBOSE";
export const ENV_SKIP_PREFLIGHT = "MB_CLI_SKIP_PREFLIGHT";
export const ENV_SKILLS_DIR = "MB_SKILLS_DIR";

// Every `MB_` variable the CLI reads goes through here, so the names above are the whole list.
export function readEnv(name: string): string | undefined {
  return process.env[name];
}
