import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { describeVersion } from "@metabase/client/version/tag";

import { AuthStatus } from "../../packages/cli/src/commands/auth/status";
import { CardListEnvelope } from "../../packages/cli/src/commands/card/list";
import { MeasureListEnvelope } from "../../packages/cli/src/commands/measure/list";
import { summarizeServer } from "../../packages/cli/src/core/auth/server-summary";
import {
  probeAt,
  SEED_USER,
  type SeedTarget,
  DEVELOPMENT_PROBE,
} from "../../packages/cli/src/core/auth/temp-config-home";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import {
  seedProbedProfile,
  seedProbedProfileAt,
  seedProfile,
  UNREACHABLE_SEED_MESSAGE,
} from "./seed-profile";
import { E2E_BUILTIN_TRANSFORM_JOBS } from "./seed/ids";
import { requireServer } from "./server-gate";

const BEYOND_KNOWN = KNOWN_RANGE.max + 5;
const BELOW_KNOWN = KNOWN_RANGE.min - 1;

const NEWER_NOTICE = `Metabase v0.${BEYOND_KNOWN}.0 is newer than this CLI supports (up to v${KNOWN_RANGE.max}); commands run as if it were v${KNOWN_RANGE.max + 1}. Run \`mb upgrade\` for a newer CLI.`;
const OLDER_NOTICE = `Metabase v0.${BELOW_KNOWN}.0 is older than this CLI supports (v${KNOWN_RANGE.min}+); a command relying on a newer feature may fail. Upgrade Metabase to v${KNOWN_RANGE.min} or later.`;

describe("server-decided gating e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("sends a command whose feature a cached v58 probe predates, rather than refusing on the cache's word", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_SEED_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("sends a gated command without a cached probe, probing nothing first", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProfile(configHome);

    const result = await runCli({ args: ["measure", "list"], configHome });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_SEED_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("sends a token-gated command a cached probe without the premium feature would have refused", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 60);

    const result = await runCli({ args: ["git-sync", "status"], configHome });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_SEED_MESSAGE);
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
    await seedProbedProfileAt(configHome, liveTarget(), probeAt(BEYOND_KNOWN));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe(NEWER_NOTICE);
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice and succeeds when the cached probe is a development build", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), DEVELOPMENT_PROBE);

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints exactly one older-server notice on stderr and still runs a baseline command when the cached probe is below the known range", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), probeAt(BELOW_KNOWN));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe(OLDER_NOTICE);
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice when the cached probe is inside the known range", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfileAt(configHome, liveTarget(), probeAt(KNOWN_RANGE.max));

    const result = await runCli({ args: ["card", "list", "--limit", "1", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  function versionChangedNote(cachedTag: string): string {
    const liveLabel = describeVersion(bootstrap.server.version);
    return `The server's version changed since the last probe (was ${cachedTag}, now ${liveLabel}); the profile was refreshed — retry the command.`;
  }

  async function expectRefreshedProbe(configHome: string, seededAt: string): Promise<void> {
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
  }

  // A cached v59 profile reads a job run as the stub-string generation; a server answering with the
  // numeric one fails that parse, and the CLI must notice the server moved.
  const shapeReprobeSkipReason = requireServer("version › re-probe on a shape error", [
    "transformJobRunIdIsNumeric",
  ]);

  describe.skipIf(shapeReprobeSkipReason !== null)("re-probe on a shape error", () => {
    it("re-probes once, refreshes the stale profile, and appends the change to the error", async () => {
      const configHome = await makeIsolatedConfigHome();
      await seedProbedProfileAt(configHome, liveTarget(), probeAt(59));
      const seededAt = await lastProbedAt(configHome);

      const result = await runCli({
        args: ["transform-job", "run", String(E2E_BUILTIN_TRANSFORM_JOBS.DAILY), "--json"],
        configHome,
      });

      expect(result.exitCode).toBe(1);
      expect(cliErrorMessage(result.stderr)).toBe(
        "On Metabase v0.59.0 the response shape was unexpected:\n" +
          "  job_run_id: Invalid input: expected string, received null\n" +
          versionChangedNote("v0.59.0"),
      );

      await expectRefreshedProbe(configHome, seededAt);
    });
  });

  // A cached v58 profile predates measures; the live server clears that floor, so the command must
  // run on the server's word rather than be refused on the cache's.
  const staleFloorSkipReason = requireServer("version › a stale cache below a floor", ["measures"]);

  describe.skipIf(staleFloorSkipReason !== null)("a stale cache below a floor", () => {
    it("runs the command the stale cache predates against the live server that clears its floor", async () => {
      const configHome = await makeIsolatedConfigHome();
      await seedProbedProfileAt(configHome, liveTarget(), probeAt(58));

      const result = await runCli({ args: ["measure", "list", "--json"], configHome });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, MeasureListEnvelope).has_more).toBe(false);
    });
  });

  // A license activated after the cache was written: the command's own check asks the server, and
  // the answer replaces the cache.
  const activatedLicenseSkipReason = requireServer(
    "version › a license activated since the cache",
    ["contentVerification"],
  );

  describe.skipIf(activatedLicenseSkipReason !== null)(
    "a license activated since the cache",
    () => {
      it("runs a check against the live server and writes its answer back to the profile", async () => {
        const configHome = await makeIsolatedConfigHome();
        const seededAt = await seedProbedProfileAt(configHome, liveTarget(), {
          ...bootstrap.server,
          tokenFeatures: {},
        });

        const result = await runCli({
          args: ["search", "orders", "--verified", "--json"],
          configHome,
        });

        expect(result.exitCode, result.stderr).toBe(0);
        await expectRefreshedProbe(configHome, seededAt);
      });
    },
  );
});
