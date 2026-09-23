import { beforeAll, describe, expect, it } from "vitest";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";

describe("HTTP error messages (end-to-end)", () => {
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

  it("resource-missing 404 renders the GET path with verb and exits 1", async () => {
    const result = await runCli({
      args: ["card", "get", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/card/9999999.");
  });

  it("list filter against a missing model id reports not-found and exits 1", async () => {
    const result = await runCli({
      args: ["card", "list", "--filter", "using_model", "--model-id", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/card");
  });
});
