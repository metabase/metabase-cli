import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NO_CREDENTIAL_MESSAGE } from "../../packages/cli/src/core/config";

import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";

const HOSTILE_ENV: Record<string, string> = {
  MB_URL: "http://127.0.0.1:9",
  MB_API_KEY: "mb_e2e_env_leak_sentinel_key",
};

describe("runCli env isolation e2e", () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(HOSTILE_ENV)) {
      savedEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv.clear();
  });

  it("reports no credentials even when the parent shell exports MB_URL and MB_API_KEY", async () => {
    const result = await runCli({ args: ["db", "list", "--json"] });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(NO_CREDENTIAL_MESSAGE);
  });
});
