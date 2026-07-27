import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempConfigHome {
  path: string;
  cleanup(): void;
}

export function setupTempConfigHome(): TempConfigHome {
  const originalEnv = { ...process.env };
  const path = mkdtempSync(join(tmpdir(), "mb-cli-"));
  process.env["XDG_CONFIG_HOME"] = path;
  delete process.env["APPDATA"];
  return {
    path,
    cleanup() {
      process.env = { ...originalEnv };
      rmSync(path, { recursive: true, force: true });
    },
  };
}
