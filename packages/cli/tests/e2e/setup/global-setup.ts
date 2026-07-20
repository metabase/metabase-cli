import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveE2EBaseUrl } from "../defaults";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(HERE, "..");
const PACKAGE_ROOT = resolve(E2E_ROOT, "..", "..");
const DIST_CLI = resolve(PACKAGE_ROOT, "dist", "cli.mjs");
const BOOTSTRAP_SCRIPT = resolve(E2E_ROOT, "setup", "bootstrap.ts");

export default async function setup(): Promise<void> {
  if (!existsSync(DIST_CLI)) {
    throw new Error(
      `Built CLI missing at ${DIST_CLI} — run \`bun run build\` before \`bun run test:e2e\`.`,
    );
  }

  await execFileAsync("bun", [BOOTSTRAP_SCRIPT], {
    env: { ...process.env, METABASE_CLI_E2E_URL: resolveE2EBaseUrl() },
  });
}
