import { beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { DocumentListEnvelope } from "../../packages/cli/src/commands/document/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";

describe("document e2e", () => {
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

  it("list returns an empty envelope on the restored snapshot, which seeds no document", async () => {
    const result = await runCli({ args: ["document", "list", "--json"], env: authEnv() });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DocumentListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["document", "get", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["document", "get", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/document/9999999.");
  });
});
