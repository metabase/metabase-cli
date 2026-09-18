import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";

import { AuthStatus } from "../../packages/cli/src/commands/auth/status";
import { CardListEnvelope } from "../../packages/cli/src/commands/card/list";
import { summarizeServer } from "../../packages/cli/src/core/auth/server-summary";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import {
  SEED_USER,
  seedProbedProfile,
  seedProbedProfileAt,
  seedProfile,
  type SeedTarget,
  versionAt,
} from "./seed-profile";
import { E2E_BUILTIN_TRANSFORM_JOBS } from "./seed/ids";
import { requireServer } from "./server-gate";

const BEYOND_KNOWN = KNOWN_RANGE.max + 5;
const BELOW_KNOWN = KNOWN_RANGE.min - 1;

const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";
const MEASURES_REFUSAL =
  "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.";
const UNREACHABLE_MESSAGE = "Could not reach Metabase: fetch failed";

const NEWER_NOTICE = `Metabase v0.${BEYOND_KNOWN}.0 is newer than this CLI supports (up to v${KNOWN_RANGE.max}); commands run as if it were a head build past v${KNOWN_RANGE.max}. Run \`mb upgrade\` for a newer CLI.`;
const UNKNOWN_NOTICE = `Could not parse the Metabase version; assuming a head build past v${KNOWN_RANGE.max}.`;
const OLDER_NOTICE = `Metabase v0.${BELOW_KNOWN}.0 is older than this CLI supports (v${KNOWN_RANGE.min}+); commands needing a newer feature are refused by name. Upgrade Metabase to v${KNOWN_RANGE.min} or later.`;

describe("version preflight enforcement e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("refuses a command whose feature the cached server version predates (exit 2)", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(`${MEASURES_REFUSAL}\n${DOWNGRADE_REMEDY}`);
    expect(result.stdout).toBe("");
  });

  it("bypasses the refusal and reaches the network layer when --skip-preflight is passed", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["measure", "list", "--skip-preflight"], configHome });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("probes the server itself when a gated command runs without a cached probe and fails on the network layer", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProfile(configHome);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("refuses a token-gated command when the cached server lacks the premium feature (exit 2)", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 60);

    const result = await runCli({ args: ["git-sync", "status"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(
      "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
    );
    expect(result.stdout).toBe("");
  });

  it("bypasses the refusal via MB_CLI_SKIP_PREFLIGHT=1 and reaches the network layer", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({
      args: ["measure", "list"],
      configHome,
      env: { MB_CLI_SKIP_PREFLIGHT: "1" },
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });
});

describe("version skew notices e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function liveTarget(): SeedTarget {
    return { url: bootstrap.baseUrl, apiKey: bootstrap.adminApiKey };
  }

  // `auth status` reads the cached probe without opening a socket, so it reports the profile as
  // the disk holds it.
  async function lastProbedAt(configHome: string): Promise<string> {
    const status = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(status.exitCode, status.stderr).toBe(0);
    const probedAt = parseJson(status.stdout, AuthStatus).lastProbedAt;
    if (probedAt === null) {
      throw new Error("expected the profile to hold a cached probe");
    }
    return probedAt;
  }

  it("prints exactly one newer-server notice on stderr and succeeds when the cached probe is above the known range", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), versionAt(BEYOND_KNOWN));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe(NEWER_NOTICE);
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints exactly one unknown-version notice on stderr and succeeds when the cached probe carries no parseable version", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), null);

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe(UNKNOWN_NOTICE);
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints exactly one older-server notice on stderr and still runs a baseline command when the cached probe is below the known range", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), versionAt(BELOW_KNOWN));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe(OLDER_NOTICE);
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice when the cached probe is inside the known range", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), versionAt(KNOWN_RANGE.max));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  // A cached v59 profile reads a job run as the stub-string generation; a server answering with the
  // numeric one fails that parse, and the CLI must notice the server moved.
  const reprobeSkipReason = requireServer("version › re-probe on a shape error", [
    "transformJobRunIdIsNumeric",
  ]);

  describe.skipIf(reprobeSkipReason !== null)("re-probe on a shape error", () => {
    it("re-probes once, refreshes the stale profile, and appends the change to the error", async () => {
      const configHome = await makeIsolatedConfigHome();
      await seedProbedProfileAt(configHome, liveTarget(), versionAt(59));
      const seededAt = await lastProbedAt(configHome);

      const result = await runCli({
        args: ["transform-job", "run", String(E2E_BUILTIN_TRANSFORM_JOBS.DAILY), "--json"],
        configHome,
      });

      expect(result.exitCode).toBe(1);
      const liveLabel =
        bootstrap.server.version === null ? "an unparseable version" : bootstrap.server.version.tag;
      expect(cliErrorMessage(result.stderr)).toBe(
        "On Metabase v0.59.0 the response shape was unexpected:\n" +
          "  job_run_id: Invalid input: expected string, received null\n" +
          `The server's version changed since the last probe (was v0.59.0, now ${liveLabel}); the profile was refreshed — retry the command.`,
      );

      const status = await runCli({ args: ["auth", "status", "--json"], configHome });
      expect(status.exitCode, status.stderr).toBe(0);
      const refreshedAt = await lastProbedAt(configHome);
      expect(parseJson(status.stdout, AuthStatus)).toEqual({
        profile: "default",
        present: true,
        url: bootstrap.baseUrl,
        method: "apiKey",
        user: SEED_USER,
        ...summarizeServer(bootstrap.server),
        lastProbedAt: refreshedAt,
        lastFailure: null,
      });
      expect(refreshedAt > seededAt).toBe(true);
    });
  });
});
