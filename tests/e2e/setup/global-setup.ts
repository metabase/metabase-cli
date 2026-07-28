import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveE2EBaseUrl } from "../defaults";
import { clearGateSkips, readGateSkips, type GateSkip } from "../server-gate";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(E2E_ROOT, "..", "..");
const DIST_CLI = resolve(REPO_ROOT, "packages", "cli", "dist", "cli.mjs");
const BOOTSTRAP_SCRIPT = resolve(E2E_ROOT, "setup", "bootstrap.ts");

const RULE = "─".repeat(78);

// Named `setup`/`teardown` rather than a default export: vitest reads `m.default` as the setup hook
// and drops `m.teardown` entirely when both are present, so a default export makes the report below
// silently never run.
export async function setup(): Promise<void> {
  if (!existsSync(DIST_CLI)) {
    throw new Error(
      `Built CLI missing at ${DIST_CLI} — run \`bun run build\` before \`bun run test:e2e\`.`,
    );
  }

  clearGateSkips();

  await execFileAsync("bun", [BOOTSTRAP_SCRIPT], {
    env: { ...process.env, METABASE_CLI_E2E_URL: resolveE2EBaseUrl() },
  });
}

export function teardown(): void {
  const skipped = readGateSkips();
  if (skipped.length === 0) {
    return;
  }
  process.stdout.write(formatGateReport(skipped));
}

function formatGateReport(skipped: GateSkip[]): string {
  const lanes = skipped.map(({ lane, reason }) => ` ${lane}\n   ${reason}`).join("\n");
  const count = skipped.length === 1 ? "1 lane" : `${skipped.length} lanes`;
  return [
    "",
    RULE,
    ` e2e coverage gaps — ${count} did not run against this server`,
    RULE,
    lanes,
    RULE,
    " The counts above cover everything else. They do not cover these.",
    "",
    "",
  ].join("\n");
}
