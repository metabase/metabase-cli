import { beforeAll, describe, expect, it } from "vitest";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

describe("dashboard parameter-values e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("parameter-values against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "9999999", "cat_param", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Not found: GET /api/dashboard/9999999/params/cat_param/values.",
    );
  });

  it("parameter-values for an unknown parameter id surfaces a 400 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", String(SEEDED.ordersDashboardId), "nope", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toContain(
      'Dashboard does not have a parameter with the ID "nope"',
    );
  });

  it("parameter-values with an empty parameter id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "1", "", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain("parameter-id must not be empty");
    expect(result.stdout).toBe("");
  });

  it("parameter-values with a non-integer dashboard id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "abc", "cat_param", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid dashboard-id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });
});
