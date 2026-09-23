import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import type { ServerInfo } from "@metabase/client/version/probe";

import { CardListEnvelope } from "../../packages/cli/src/commands/card/list";
import { probeAt } from "../../packages/cli/src/core/temp-cache-home";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";
import {
  bootstrapServerInfo,
  clearCachedProbes,
  readSeededProbe,
  seedCachedProbe,
  seedCachedProbeAt,
  UNREACHABLE_ENV,
  UNREACHABLE_URL,
} from "./seed-probe";
import { E2E_BUILTIN_TRANSFORM_JOBS } from "./seed/ids";
import { requireServer } from "./server-gate";

const BEYOND_KNOWN = KNOWN_RANGE.max + 5;
const BELOW_KNOWN = KNOWN_RANGE.min - 1;

const MEASURES_REFUSAL =
  "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.";
const UNREACHABLE_MESSAGE = "Could not reach Metabase: fetch failed";


// A server whose tag parses to nothing, as `probeServer` reports a head or local build.
const UNPARSEABLE_PROBE: ServerInfo = {
  edition: null,
  version: null,
  date: null,
  hash: null,
  tokenFeatures: null,
};

describe("version preflight enforcement e2e", () => {
  beforeEach(clearCachedProbes);

  it("refuses a command whose feature the cached server version predates (exit 2)", async () => {
    await seedCachedProbe(UNREACHABLE_URL, 58);

    const result = await runCli({ args: ["measure", "list"], env: UNREACHABLE_ENV });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(MEASURES_REFUSAL);
    expect(result.stdout).toBe("");
  });

  it("bypasses the refusal and reaches the network layer when --skip-preflight is passed", async () => {
    await seedCachedProbe(UNREACHABLE_URL, 58);

    const result = await runCli({
      args: ["measure", "list", "--skip-preflight"],
      env: UNREACHABLE_ENV,
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("probes the server itself when a gated command runs without a cached probe and fails on the network layer", async () => {
    const result = await runCli({ args: ["measure", "list"], env: UNREACHABLE_ENV });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("refuses a token-gated command when the cached server lacks the premium feature (exit 2)", async () => {
    await seedCachedProbe(UNREACHABLE_URL, 60);

    const result = await runCli({ args: ["git-sync", "status"], env: UNREACHABLE_ENV });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(
      "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
    );
    expect(result.stdout).toBe("");
  });

  it("bypasses the refusal via MB_CLI_SKIP_PREFLIGHT=1 and reaches the network layer", async () => {
    await seedCachedProbe(UNREACHABLE_URL, 58);

    const result = await runCli({
      args: ["measure", "list"],
      env: { ...UNREACHABLE_ENV, MB_CLI_SKIP_PREFLIGHT: "1" },
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_MESSAGE);
    expect(result.stdout).toBe("");
  });
});

describe("version skew notices e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  beforeEach(clearCachedProbes);

  function liveEnv(): Record<string, string> {
    return { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey };
  }

  it("prints no notice and succeeds when the cached probe is above the known range", async () => {
    await seedCachedProbeAt(bootstrap.baseUrl, probeAt(BEYOND_KNOWN));

    const result = await runCli({
      args: ["card", "list", "--limit", "1", "--json"],
      env: liveEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice and succeeds when the cached probe carries no parseable version", async () => {
    await seedCachedProbeAt(bootstrap.baseUrl, UNPARSEABLE_PROBE);

    const result = await runCli({
      args: ["card", "list", "--limit", "1", "--json"],
      env: liveEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice and still runs a baseline command when the cached probe is below the known range", async () => {
    await seedCachedProbeAt(bootstrap.baseUrl, probeAt(BELOW_KNOWN));

    const result = await runCli({
      args: ["card", "list", "--limit", "1", "--json"],
      env: liveEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout, CardListEnvelope).returned).toBe(1);
  });

  it("prints no notice when the cached probe is inside the known range", async () => {
    await seedCachedProbeAt(bootstrap.baseUrl, probeAt(KNOWN_RANGE.max));

    const result = await runCli({
      args: ["card", "list", "--limit", "1", "--json"],
      env: liveEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  function versionChangedNote(cachedTag: string): string {
    const liveLabel =
      bootstrap.server.version === null ? "an unparseable version" : bootstrap.server.version.tag;
    return `The server's version changed since the last probe (was ${cachedTag}, now ${liveLabel}); the cached server probe was refreshed — retry the command.`;
  }

  async function expectRefreshedProbe(): Promise<void> {
    expect(await readSeededProbe(bootstrap.baseUrl)).toEqual(bootstrapServerInfo(bootstrap.server));
  }

  // A cached v59 probe reads a job run as the stub-string generation; a server answering with the
  // numeric one fails that parse, and the CLI must notice the server moved.
  const shapeReprobeSkipReason = requireServer("version › re-probe on a shape error", [
    "transformJobRunIdIsNumeric",
  ]);

  describe.skipIf(shapeReprobeSkipReason !== null)("re-probe on a shape error", () => {
    it("re-probes once, refreshes the stale cache, and appends the change to the error", async () => {
      await seedCachedProbeAt(bootstrap.baseUrl, probeAt(59));

      const result = await runCli({
        args: ["transform-job", "run", String(E2E_BUILTIN_TRANSFORM_JOBS.DAILY), "--json"],
        env: liveEnv(),
      });

      expect(result.exitCode).toBe(1);
      expect(cliErrorMessage(result.stderr)).toBe(
        "On Metabase v0.59.0 the response shape was unexpected:\n" +
          "  job_run_id: Invalid input: expected string, received null\n" +
          versionChangedNote("v0.59.0"),
      );

      await expectRefreshedProbe();
    });
  });

  // A cached v58 probe refuses measures before any request; the live server clears that floor,
  // so the refusal is the stale-probe case the CLI must diagnose without retrying the command.
  const refusalReprobeSkipReason = requireServer("version › re-probe on a refusal", ["measures"]);

  describe.skipIf(refusalReprobeSkipReason !== null)("re-probe on a refusal", () => {
    it("re-probes once, refreshes the stale cache, and appends the change to the refusal", async () => {
      await seedCachedProbeAt(bootstrap.baseUrl, probeAt(58));

      const result = await runCli({ args: ["measure", "list", "--json"], env: liveEnv() });

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(
        `${MEASURES_REFUSAL}\n${versionChangedNote("v0.58.0")}`,
      );
      expect(result.stdout).toBe("");

      await expectRefreshedProbe();
    });
  });
});
