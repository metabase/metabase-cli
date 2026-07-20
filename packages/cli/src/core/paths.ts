import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "metabase-cli";

// Resolves the per-user CLI config directory, XDG/AppData-idiomatic per platform:
//
// macOS / Linux:  $XDG_CONFIG_HOME/metabase-cli   (default ~/.config/metabase-cli)
// Windows:        %APPDATA%/metabase-cli           (default ~/AppData/Roaming/metabase-cli)
export function configDir(): string {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_DIR_NAME);
  }
  const xdg = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(xdg, APP_DIR_NAME);
}
