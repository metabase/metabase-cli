import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { AuthStatus } from "../../packages/cli/src/commands/auth/status";
import { DEFAULT_PROFILE } from "../../packages/cli/src/core/auth/storage";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const SENTINEL_PROFILE = "e2e_env_leak_sentinel";

const HOSTILE_ENV: Record<string, string> = {
  MB_URL: "http://127.0.0.1:9",
  MB_API_KEY: "mb_e2e_env_leak_sentinel_key",
  MB_PROFILE: SENTINEL_PROFILE,
  METABASE_URL: "http://127.0.0.1:9",
  METABASE_API_KEY: "mb_e2e_env_leak_sentinel_key",
  METABASE_PROFILE: SENTINEL_PROFILE,
};

describe("runCli env isolation e2e", () => {
  const tempDirs: string[] = [];
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(HOSTILE_ENV)) {
      savedEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(async () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv.clear();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("routes to the default profile even when the parent shell exports MB_PROFILE", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({ args: ["auth", "status", "--json"], configHome });

    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout, AuthStatus)).toEqual({
      profile: DEFAULT_PROFILE,
      present: false,
      url: null,
      method: null,
      user: null,
      version: null,
      tokenFeatures: null,
      lastProbedAt: null,
      lastFailure: null,
    });
  });

  it("reports no credentials even when the parent shell exports MB_URL and MB_API_KEY", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({ args: ["db", "list", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      `Not authenticated for profile "${DEFAULT_PROFILE}".`,
    );
  });
});
