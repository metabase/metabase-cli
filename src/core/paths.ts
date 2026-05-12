import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "metabase-cli";

// Resolves the per-user CLI config directory in a way that's both XDG/AppData-idiomatic
// and Docker Desktop-shareable on macOS and Windows (every supported OS routes through the
// user's home, which Docker Desktop shares out of the box; `os.tmpdir()` does not on macOS).
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
