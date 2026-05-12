import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("setup e2e", () => {
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

  function authEnv(): Record<string, string> {
    return {
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("rejects a malformed body with a ValidationError before any HTTP round-trip", async () => {
    const result = await runCli({
      args: ["setup", "--body", JSON.stringify({ user: { email: "x@y.z" } })],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    // ValidationError shares exit 1 with HttpError; the message anchor is
    // what distinguishes "body failed Zod" from "backend rejected the call."
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
  });

  it("surfaces the backend's setup-token error as HttpError exit code on a fully-bootstrapped instance", async () => {
    // bootstrap.ts has already consumed the real setup-token; sending any
    // other token is the one cross-network failure mode we can reliably
    // exercise without tearing down state. We assert exit code 1 (HttpError
    // taxonomy, not ConfigError=2) and that the failure didn't come from
    // CLI-side body validation — i.e. the request crossed the network.
    const result = await runCli({
      args: [
        "setup",
        "--body",
        JSON.stringify({
          token: "bogus-token",
          user: {
            first_name: "E",
            last_name: "E",
            email: "setup@example.invalid",
            password: "Sup3rs3cret!",
          },
          prefs: { site_name: "e2e-setup-test" },
        }),
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("value did not match expected schema");
    expect(result.stderr).not.toContain("invalid JSON");
  });
});
