import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "metabase-rde";

// The per-user cache directory, XDG on macOS and Linux and LocalAppData on Windows.
export function cacheDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
    return join(localAppData, APP_DIR_NAME);
  }
  const xdg = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  return join(xdg, APP_DIR_NAME);
}
